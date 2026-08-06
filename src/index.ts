import path from 'node:path';
import type { Server } from 'node:http';
import {
  AuthenticationService,
  BrowserSessionCookie,
  GitHubAuthorizationService,
  GitHubOAuthClient,
  GitHubOAuthFlow,
  SecretAuthenticator,
} from './auth/index.js';
import { BrainKernel } from './brain/index.js';
import { loadConfig } from './config.js';
import { GitHubProposalGateway } from './github/index.js';
import {
  OctokitGitHubAuthorizationGateway,
  asInstrumentedGitHubClient,
  createInstallationOctokit,
  githubConnectivityCheck,
} from './integrations/github.js';
import { createHttpApplication, type GitHubAuthRoutesDependencies } from './http/index.js';
import type { GitHubConnectivity } from './mcp/index.js';
import { createLogger, createTelemetry } from './observability/index.js';
import { SqliteProposalStore } from './persistence/sqlite-proposal-store.js';
import { DisabledSessionStore, SqliteSessionStore, type SessionStore } from './sessions/index.js';

function repositoryRelativeBrainRoot(repositoryRoot: string, brainRoot: string): string {
  const relative = path.relative(repositoryRoot, brainRoot);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('BRAIN_ROOT must be located within the repository for GitHub proposals.');
  }
  return relative.split(path.sep).join('/');
}

function waitForServerClose(server: Server, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    server.close(finish);
    const timer = setTimeout(() => {
      server.closeAllConnections();
      finish();
    }, timeoutMs);
    timer.unref();
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ environment: config.environment });
  const telemetry = createTelemetry(config.langfuse, logger);

  const brain = new BrainKernel({
    rootDir: config.brainRoot,
    repositoryRoot: config.repositoryRoot,
  });
  await telemetry.observe(
    'brain.discover',
    {
      metadata: { brain_root: path.relative(config.repositoryRoot, config.brainRoot) },
      resultMetadata: (value) => {
        const health = value as ReturnType<BrainKernel['health']>;
        return {
          indexed_file_count: health.indexedFileCount,
          indexed_concept_count: health.indexedConceptCount,
          validation_error_count: health.validationErrors,
          validation_warning_count: health.validationWarnings,
        };
      },
    },
    async () => brain.refresh(),
  );

  let sessions: SessionStore;
  if (config.auth.sessionEncryptionKey) {
    sessions = new SqliteSessionStore({
      path: config.auth.sessionDbPath,
      encryptionKey: config.auth.sessionEncryptionKey,
      sessionTtlSeconds: config.auth.sessionTtlSeconds,
    });
  } else {
    sessions = new DisabledSessionStore();
  }
  await sessions.initialize();

  const secretAuthenticator = config.auth.secretKey
    ? new SecretAuthenticator({
        secret: config.auth.secretKey,
        repository: config.repositorySlug,
        allowWrites: config.auth.allowSecretWrites,
        production: config.environment === 'production',
      })
    : undefined;
  const browserCookie =
    config.auth.sessionSecret && config.publicBaseUrl
      ? new BrowserSessionCookie({
          secret: config.auth.sessionSecret,
          publicBaseUrl: config.publicBaseUrl.href,
          maxAgeSeconds: config.auth.sessionTtlSeconds,
        })
      : undefined;
  const oauthStateCookie =
    config.auth.sessionSecret && config.publicBaseUrl
      ? new BrowserSessionCookie({
          secret: config.auth.sessionSecret,
          publicBaseUrl: config.publicBaseUrl.href,
          name: 'company_brain_oauth_state',
          maxAgeSeconds: 600,
        })
      : undefined;
  const authentication = new AuthenticationService({
    mode: config.auth.mode,
    sessions,
    ...(secretAuthenticator === undefined ? {} : { secretAuthenticator }),
    ...(browserCookie === undefined ? {} : { browserCookie }),
  });

  let githubAuth: GitHubAuthRoutesDependencies | undefined;
  let proposals: GitHubProposalGateway | undefined;
  let proposalStore: SqliteProposalStore | undefined;
  let githubConnectivity: () => Promise<GitHubConnectivity> = () =>
    Promise.resolve({ status: 'disabled' });

  if (config.github && browserCookie && oauthStateCookie) {
    const oauthClient = new GitHubOAuthClient({
      clientId: config.github.clientId,
      clientSecret: config.github.clientSecret,
      callbackUrl: config.github.callbackUrl.href,
    });
    const oauthFlow = new GitHubOAuthFlow(sessions, oauthClient);
    const authorization = new GitHubAuthorizationService(
      new OctokitGitHubAuthorizationGateway(config.github.installationId, telemetry),
      {
        repository: config.repositorySlug,
        allowedOrganizations: config.github.allowedOrgs,
        allowedTeams: config.github.allowedTeams,
      },
    );
    githubAuth = {
      flow: oauthFlow,
      authorization,
      sessions,
      cookie: browserCookie,
      oauthStateCookie,
    };

    const installationOctokit = createInstallationOctokit(config.github);
    const installationClient = asInstrumentedGitHubClient(installationOctokit, telemetry);
    proposalStore = new SqliteProposalStore(config.auth.sessionDbPath);
    proposals = new GitHubProposalGateway({
      owner: config.github.owner,
      repository: config.github.repository,
      defaultBranch: config.github.defaultBranch,
      brainRoot: repositoryRelativeBrainRoot(config.repositoryRoot, config.brainRoot),
      validationRoots: ['knowledge'],
      sessions,
      proposalStore,
      brain,
      oauth: oauthClient,
      authorization,
      telemetry,
      installationClient,
    });
    githubConnectivity = githubConnectivityCheck(installationOctokit, config.github);
  }

  const httpApplication = createHttpApplication({
    config,
    authentication,
    sessions,
    telemetry,
    logger,
    ...(githubAuth === undefined ? {} : { githubAuth }),
    mcp: {
      brain,
      telemetry,
      ...(proposals === undefined ? {} : { proposals }),
      gitSha: config.gitSha,
      configurationWarnings: config.warnings,
      githubConnectivity,
    },
  });

  const server = httpApplication.app.listen(config.port, config.host, () => {
    logger.info('Company Brain MCP server is listening.', {
      host: config.host,
      port: config.port,
      auth_mode: config.auth.mode,
      brain_concepts: brain.health().indexedConceptCount,
      langfuse_enabled: telemetry.enabled,
    });
  });
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;
  server.keepAliveTimeout = config.keepAliveTimeoutMs;
  server.timeout = 0;

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Company Brain MCP server is shutting down.', { reason });
    const serverClosed = waitForServerClose(server, 15_000);
    await httpApplication.close();
    await serverClosed;
    await sessions.close();
    proposalStore?.close();
    await telemetry.shutdown();
    process.exitCode = exitCode;
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.once('SIGINT', () => void shutdown('SIGINT', 0));
  process.once('uncaughtException', (error) => {
    logger.error('Uncaught exception.', { error });
    void shutdown('uncaughtException', 1);
  });
  process.once('unhandledRejection', (error) => {
    logger.error('Unhandled rejection.', { error });
    void shutdown('unhandledRejection', 1);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Startup failed.';
  process.stderr.write(`${JSON.stringify({ level: 'error', message })}\n`);
  process.exitCode = 1;
});
