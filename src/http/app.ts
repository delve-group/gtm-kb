import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import {
  AuthError,
  constantTimeSecretEqual,
  type AuthenticationService,
  type BrowserSessionCookie,
  type GitHubAuthorizationService,
  type GitHubOAuthFlow,
} from '../auth/index.js';
import type { AppConfig } from '../config.js';
import { AppError, serializeError, toAppError } from '../errors.js';
import { createCompanyBrainMcpServer, type CompanyBrainMcpDependencies } from '../mcp/index.js';
import type { Logger, Telemetry } from '../observability/index.js';
import type { SessionStore } from '../sessions/index.js';
import { FixedWindowRateLimiter } from './rate-limiter.js';
import { actorFromAuthInfo, principalToMcpAuthInfo } from './request-authenticator.js';

export interface GitHubAuthRoutesDependencies {
  readonly flow: GitHubOAuthFlow;
  readonly authorization: GitHubAuthorizationService;
  readonly sessions: SessionStore;
  readonly cookie: BrowserSessionCookie;
  readonly oauthStateCookie: BrowserSessionCookie;
}

export interface HttpApplicationDependencies {
  readonly config: AppConfig;
  readonly authentication: AuthenticationService;
  readonly sessions: SessionStore;
  readonly mcp: CompanyBrainMcpDependencies;
  readonly telemetry: Telemetry;
  readonly logger: Logger;
  readonly githubAuth?: GitHubAuthRoutesDependencies;
}

export interface HttpApplication {
  readonly app: ReturnType<typeof createMcpExpressApp>;
  close(): Promise<void>;
}

type AuthenticatedRequest = Request & { auth?: AuthInfo };

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requestId(request: Request): string {
  const supplied = header(request, 'x-request-id');
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

function mcpObservationName(body: unknown): string {
  if (!body || typeof body !== 'object') return 'mcp.protocol.unknown';
  const message = body as { method?: unknown; params?: { name?: unknown } };
  if (message.method === 'tools/call' && typeof message.params?.name === 'string') {
    return `mcp.tool.${message.params.name}`;
  }
  return `mcp.protocol.${typeof message.method === 'string' ? message.method.replace('/', '.') : 'unknown'}`;
}

function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1_024) return undefined;
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\r\n\0]/.test(value)
  ) {
    return undefined;
  }
  return value;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sendError(response: Response, error: unknown, correlationId: string): void {
  const mapped = toAppError(error, correlationId);
  if (mapped.status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
  response.status(mapped.status).json({ ok: false, error: serializeError(mapped) });
}

function rateLimit(limiter: FixedWindowRateLimiter) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const decision = limiter.check(request.ip ?? request.socket.remoteAddress ?? 'unknown');
    if (decision.allowed) {
      next();
      return;
    }
    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    response.setHeader('Cache-Control', 'no-store');
    next(
      new AppError('RATE_LIMITED', 'Too many authentication requests.', {
        details: { retry_after_seconds: decision.retryAfterSeconds },
      }),
    );
  };
}

function installGitHubAuthRoutes(
  app: ReturnType<typeof createMcpExpressApp>,
  dependencies: HttpApplicationDependencies,
): void {
  const routes = dependencies.githubAuth;
  const callbackUrl = dependencies.config.github?.callbackUrl;
  if (!routes || !callbackUrl) {
    app.get('/auth/github/login', (_request, response) => {
      response.status(404).json({ ok: false, error: 'GitHub authentication is disabled.' });
    });
    return;
  }

  const loginLimiter = new FixedWindowRateLimiter({
    windowMs: 10 * 60_000,
    perKeyLimit: 20,
    globalLimit: 300,
  });
  const exchangeLimiter = new FixedWindowRateLimiter({
    windowMs: 10 * 60_000,
    perKeyLimit: 40,
    globalLimit: 600,
  });

  app.get('/auth/github/login', rateLimit(loginLimiter), async (request, response) => {
    const correlationId = requestId(request);
    try {
      const returnTo = safeReturnTo(request.query.return_to);
      const login =
        typeof request.query.login === 'string' ? request.query.login.slice(0, 100) : undefined;
      const result = await routes.flow.begin({
        ...(returnTo === undefined ? {} : { returnTo }),
        ...(login === undefined ? {} : { login }),
      });
      const oauthState = new URL(result.authorizationUrl).searchParams.get('state');
      if (!oauthState) throw new Error('OAuth state could not be created.');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Set-Cookie', routes.oauthStateCookie.serialize(oauthState));
      response.redirect(302, result.authorizationUrl);
    } catch (error) {
      sendError(response, error, correlationId);
    }
  });

  app.get('/auth/github/callback', async (request, response) => {
    const correlationId = requestId(request);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const state = typeof request.query.state === 'string' ? request.query.state : '';
      const browserState = routes.oauthStateCookie.read(header(request, 'cookie'));
      if (!state || !browserState || !constantTimeSecretEqual(browserState, state)) {
        throw new AuthError('UNAUTHENTICATED', 'The OAuth browser state is invalid.', 401);
      }
      response.setHeader('Set-Cookie', routes.oauthStateCookie.clear());
      if (typeof request.query.error === 'string') {
        throw new AuthError('UNAUTHENTICATED', 'GitHub authorization was not completed.', 401);
      }
      const code = typeof request.query.code === 'string' ? request.query.code : '';
      if (!code) {
        throw new AuthError('UNAUTHENTICATED', 'The OAuth callback is incomplete.', 401);
      }

      const completed = await routes.flow.complete({
        code,
        state,
        callbackUrl: callbackUrl.href,
      });
      const actor = await dependencies.telemetry.observe(
        'auth.github.authorize',
        { metadata: { repository: dependencies.config.repositorySlug } },
        async () => routes.authorization.authorize(completed.credentials),
      );
      const issued = await routes.sessions.createSession({
        actor,
        githubCredentials: completed.credentials,
        ttlSeconds: dependencies.config.auth.sessionTtlSeconds,
      });
      const exchange = await routes.sessions.createExchangeCode(issued.session.id);
      if (!exchange) throw new Error('One-time exchange code could not be created.');

      response.setHeader('Set-Cookie', [
        routes.oauthStateCookie.clear(),
        routes.cookie.serialize(issued.session.id),
      ]);
      const continueLink = completed.returnTo
        ? `<p><a href="${htmlEscape(completed.returnTo)}">Continue</a></p>`
        : '';
      response.status(200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Company Brain authenticated</title></head><body>
<main><h1>GitHub authentication complete</h1>
<p>Copy this short-lived, one-time code into your MCP client exchange step:</p>
<pre><code>${htmlEscape(exchange.code)}</code></pre>
<p>Exchange it with <code>POST /auth/github/exchange</code>. It expires at
<time>${htmlEscape(exchange.expiresAt.toISOString())}</time>.</p>${continueLink}</main>
</body></html>`);
    } catch (error) {
      sendError(response, error, correlationId);
    }
  });

  app.post('/auth/github/exchange', rateLimit(exchangeLimiter), async (request, response) => {
    const correlationId = requestId(request);
    response.setHeader('Cache-Control', 'no-store');
    try {
      const body = request.body as { code?: unknown } | undefined;
      if (typeof body?.code !== 'string' || body.code.length < 20 || body.code.length > 256) {
        throw new AuthError('UNAUTHENTICATED', 'The one-time exchange code is invalid.', 401);
      }
      const issued = await routes.sessions.consumeExchangeCode(body.code);
      if (!issued) {
        throw new AuthError(
          'UNAUTHENTICATED',
          'The one-time exchange code is invalid or expired.',
          401,
        );
      }
      response.json({
        token_type: 'Bearer',
        access_token: issued.bearerToken,
        expires_at: issued.session.expiresAt.toISOString(),
      });
    } catch (error) {
      sendError(response, error, correlationId);
    }
  });
}

export function createHttpApplication(dependencies: HttpApplicationDependencies): HttpApplication {
  const app = createMcpExpressApp({
    host: dependencies.config.host,
    ...(dependencies.config.allowedHosts.length === 0
      ? {}
      : {
          allowedHosts: [...dependencies.config.allowedHosts],
          allowedOrigins: [...dependencies.config.allowedHosts],
        }),
    jsonLimit: '5mb',
  });
  app.set('trust proxy', dependencies.config.trustProxy);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          styleSrc: ["'unsafe-inline'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  const mcpHandler = createMcpHandler(
    (context) => {
      const actor = actorFromAuthInfo(context.authInfo);
      const sessionId = context.authInfo?.extra?.sessionId;
      return createCompanyBrainMcpServer(dependencies.mcp, {
        actor,
        ...(typeof sessionId === 'string' ? { sessionId } : {}),
      });
    },
    {
      keepAliveMs: 15_000,
      responseMode: 'auto',
      onerror: (error) => dependencies.logger.error('MCP protocol error.', { error }),
    },
  );
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => dependencies.logger.error('MCP HTTP adapter error.', { error }),
  });

  app.get('/healthz', (_request, response) => {
    const health = dependencies.mcp.brain.health();
    const ready = health.indexedConceptCount > 0 && health.validationStatus !== 'fail';
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable',
      indexed_concepts: health.indexedConceptCount,
      validation: health.validationStatus,
      uptime_seconds: Math.floor(process.uptime()),
    });
  });

  installGitHubAuthRoutes(app, dependencies);

  app.get('/auth/me', async (request, response) => {
    const correlationId = requestId(request);
    response.setHeader('Cache-Control', 'no-store');
    try {
      const authorizationHeader = header(request, 'authorization');
      const cookieHeader = header(request, 'cookie');
      const principal = await dependencies.authentication.authenticate({
        ...(authorizationHeader === undefined ? {} : { authorizationHeader }),
        ...(cookieHeader === undefined ? {} : { cookieHeader }),
      });
      response.json({ ok: true, ...principal.toJSON() });
    } catch (error) {
      sendError(response, error, correlationId);
    }
  });

  app.post('/auth/logout', async (request, response) => {
    const correlationId = requestId(request);
    response.setHeader('Cache-Control', 'no-store');
    try {
      const authorization = header(request, 'authorization');
      const bearerPrincipal = authorization
        ? await dependencies.authentication.authenticate({ authorizationHeader: authorization })
        : undefined;
      if (dependencies.githubAuth) {
        response.setHeader('Set-Cookie', dependencies.githubAuth.cookie.clear());
      }
      let revoked = await dependencies.authentication.logout(header(request, 'cookie'));
      if (authorization) {
        if (bearerPrincipal?.sessionId) {
          revoked =
            (await dependencies.sessions.revokeSession(bearerPrincipal.sessionId)) || revoked;
        }
      }
      response.status(200).json({ ok: true, revoked });
    } catch (error) {
      sendError(response, error, correlationId);
    }
  });

  app.all('/mcp', async (request: AuthenticatedRequest, response: Response) => {
    const correlationId = requestId(request);
    response.setHeader('X-Request-Id', correlationId);
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    const observation = mcpObservationName(request.body);
    try {
      await dependencies.telemetry.observe(
        observation,
        {
          metadata: {
            mcp_tool_name: observation.startsWith('mcp.tool.')
              ? observation.slice('mcp.tool.'.length)
              : undefined,
            request_id: correlationId,
          },
          resultMetadata: () => ({ http_status: response.statusCode }),
        },
        async () => {
          const authorization = header(request, 'authorization');
          const principal = await dependencies.telemetry.observe(
            'auth.authenticate',
            { metadata: { request_id: correlationId } },
            async () =>
              dependencies.authentication.authenticate({
                ...(authorization === undefined ? {} : { authorizationHeader: authorization }),
              }),
          );
          request.auth = principalToMcpAuthInfo(authorization ?? '', principal);
          await nodeHandler(request, response, request.body);
        },
      );
    } catch (error) {
      if (!response.headersSent) sendError(response, error, correlationId);
      else
        dependencies.logger.warn('MCP request failed after response headers were sent.', { error });
    }
  });

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ ok: false, error: 'Not found.' });
  });
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next;
    sendError(response, error, randomUUID());
  });

  return {
    app,
    async close() {
      await mcpHandler.close();
    },
  };
}
