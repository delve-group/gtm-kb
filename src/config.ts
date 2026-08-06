import path from 'node:path';
import { z } from 'zod/v4';

export type AuthMode = 'secret' | 'github' | 'hybrid';

export interface AppConfig {
  readonly environment: string;
  readonly brainRoot: string;
  readonly repositoryRoot: string;
  readonly repositorySlug: string;
  readonly host: string;
  readonly port: number;
  readonly publicBaseUrl?: URL;
  readonly trustProxy: boolean | number;
  readonly allowedHosts: readonly string[];
  readonly requestTimeoutMs: number;
  readonly headersTimeoutMs: number;
  readonly keepAliveTimeoutMs: number;
  readonly auth: {
    readonly mode: AuthMode;
    readonly secretKey?: string;
    readonly allowSecretWrites: boolean;
    readonly sessionSecret?: string;
    readonly sessionEncryptionKey?: string;
    readonly sessionTtlSeconds: number;
    readonly sessionDbPath: string;
  };
  readonly github?: {
    readonly appId: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly privateKey: string;
    readonly installationId: number;
    readonly owner: string;
    readonly repository: string;
    readonly defaultBranch: string;
    readonly allowedOrgs: readonly string[];
    readonly allowedTeams: readonly string[];
    readonly callbackUrl: URL;
  };
  readonly langfuse: {
    readonly enabled: boolean;
    readonly publicKey?: string;
    readonly secretKey?: string;
    readonly baseUrl?: string;
    readonly environment: string;
    readonly release?: string;
  };
  readonly gitSha: string;
  readonly warnings: readonly string[];
}

const booleanValue = z
  .string()
  .optional()
  .transform((value) => value?.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']).optional())
  .transform((value) => value === 'true' || value === '1');

const integerValue = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  BRAIN_ROOT: z.string().default('brain'),
  MCP_HOST: z.string().default('127.0.0.1'),
  MCP_PORT: z.string().optional(),
  PORT: z.string().optional(),
  PUBLIC_BASE_URL: z.string().optional(),
  TRUST_PROXY: z.string().default('0'),
  MCP_ALLOWED_HOSTS: z.string().optional(),
  REQUEST_TIMEOUT_MS: integerValue(300_000, 1_000, 3_600_000),
  HEADERS_TIMEOUT_MS: integerValue(65_000, 1_000, 600_000),
  KEEP_ALIVE_TIMEOUT_MS: integerValue(75_000, 1_000, 600_000),
  AUTH_MODE: z.enum(['secret', 'github', 'hybrid']).default('hybrid'),
  SECRET_KEY: z.string().optional(),
  ALLOW_SECRET_WRITES: booleanValue.default(false),
  SESSION_SECRET: z.string().optional(),
  SESSION_ENCRYPTION_KEY: z.string().optional(),
  SESSION_TTL_SECONDS: integerValue(3600, 60, 2_592_000),
  SESSION_DB_PATH: z.string().default('data/sessions.sqlite'),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_INSTALLATION_ID: z.string().optional(),
  GITHUB_REPOSITORY: z.string().optional(),
  GITHUB_DEFAULT_BRANCH: z.string().default('main'),
  GITHUB_ALLOWED_ORGS: z.string().optional(),
  GITHUB_ALLOWED_TEAMS: z.string().optional(),
  LANGFUSE_ENABLED: booleanValue.default(false),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().optional(),
  LANGFUSE_ENVIRONMENT: z.string().default('development'),
  LANGFUSE_RELEASE: z.string().optional(),
  APP_GIT_SHA: z.string().default('unknown'),
});

function requireVariables(
  env: Record<string, string | undefined>,
  names: readonly string[],
  context: string,
): void {
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`${context} requires environment variables: ${missing.join(', ')}`);
  }
}

function requiredVariable(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePrivateKey(value: string): string {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value;
}

function parseTrustProxy(value: string): boolean | number {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false' || normalized === '0' || normalized === '') return false;
  const numeric = Number.parseInt(normalized, 10);
  if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric;
  throw new Error('TRUST_PROXY must be true, false, 0, or a non-negative hop count');
}

function parsePublicBaseUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('PUBLIC_BASE_URL must be an http(s) origin without credentials or a path');
  }
  return url;
}

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
  repositoryRoot = process.cwd(),
): AppConfig {
  const parsed = envSchema.parse(source);
  const port = Number.parseInt(parsed.PORT ?? parsed.MCP_PORT ?? '3000', 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT or MCP_PORT must be an integer from 1 to 65535');
  }

  const publicBaseUrl = parsePublicBaseUrl(parsed.PUBLIC_BASE_URL);
  const usesSecret = parsed.AUTH_MODE === 'secret' || parsed.AUTH_MODE === 'hybrid';
  const usesGitHub = parsed.AUTH_MODE === 'github' || parsed.AUTH_MODE === 'hybrid';

  if (usesSecret) {
    requireVariables(source, ['SECRET_KEY'], `AUTH_MODE=${parsed.AUTH_MODE}`);
    if (parsed.NODE_ENV === 'production' && (parsed.SECRET_KEY?.length ?? 0) < 32) {
      throw new Error('SECRET_KEY must contain at least 32 characters in production');
    }
  }

  if (usesGitHub) {
    requireVariables(
      source,
      [
        'PUBLIC_BASE_URL',
        'SESSION_SECRET',
        'SESSION_ENCRYPTION_KEY',
        'GITHUB_APP_ID',
        'GITHUB_CLIENT_ID',
        'GITHUB_CLIENT_SECRET',
        'GITHUB_APP_PRIVATE_KEY',
        'GITHUB_INSTALLATION_ID',
        'GITHUB_REPOSITORY',
      ],
      `AUTH_MODE=${parsed.AUTH_MODE}`,
    );
    if (parsed.NODE_ENV === 'production' && publicBaseUrl?.protocol !== 'https:') {
      throw new Error('PUBLIC_BASE_URL must use https in production GitHub authentication mode');
    }
  }

  if (parsed.LANGFUSE_ENABLED) {
    requireVariables(
      source,
      ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'],
      'LANGFUSE_ENABLED=true',
    );
  }

  const warnings: string[] = [];
  if (parsed.APP_GIT_SHA === 'unknown') warnings.push('APP_GIT_SHA is not configured.');
  if (!parsed.LANGFUSE_ENABLED) warnings.push('Langfuse telemetry is disabled.');

  let github: AppConfig['github'];
  if (usesGitHub) {
    const [owner, repository, extra] = (parsed.GITHUB_REPOSITORY ?? '').split('/');
    if (!owner || !repository || extra) {
      throw new Error('GITHUB_REPOSITORY must use owner/repository format');
    }
    const installationId = Number.parseInt(parsed.GITHUB_INSTALLATION_ID ?? '', 10);
    if (!Number.isSafeInteger(installationId) || installationId < 1) {
      throw new Error('GITHUB_INSTALLATION_ID must be a positive integer');
    }
    if (!publicBaseUrl) throw new Error('PUBLIC_BASE_URL is required for GitHub authentication');
    const callbackUrl = new URL('/auth/github/callback', publicBaseUrl);
    github = {
      appId: requiredVariable(source, 'GITHUB_APP_ID'),
      clientId: requiredVariable(source, 'GITHUB_CLIENT_ID'),
      clientSecret: requiredVariable(source, 'GITHUB_CLIENT_SECRET'),
      privateKey: normalizePrivateKey(requiredVariable(source, 'GITHUB_APP_PRIVATE_KEY')),
      installationId,
      owner,
      repository,
      defaultBranch: parsed.GITHUB_DEFAULT_BRANCH,
      allowedOrgs: splitCsv(parsed.GITHUB_ALLOWED_ORGS),
      allowedTeams: splitCsv(parsed.GITHUB_ALLOWED_TEAMS),
      callbackUrl,
    };
  }

  const configuredAllowedHosts = splitCsv(parsed.MCP_ALLOWED_HOSTS);
  if (publicBaseUrl && configuredAllowedHosts.length === 0) {
    configuredAllowedHosts.push(publicBaseUrl.hostname);
  }
  // The image health check runs inside the container against 127.0.0.1. Keep
  // loopback explicit when public host protection is enabled so that checking
  // liveness does not require weakening DNS-rebinding protection globally.
  const allowedHosts = [...new Set([...configuredAllowedHosts, '127.0.0.1', 'localhost', '[::1]'])];

  return {
    environment: parsed.NODE_ENV,
    brainRoot: path.resolve(repositoryRoot, parsed.BRAIN_ROOT),
    repositoryRoot: path.resolve(repositoryRoot),
    repositorySlug: parsed.GITHUB_REPOSITORY ?? 'local/company-brain',
    host: parsed.MCP_HOST,
    port,
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
    trustProxy: parseTrustProxy(parsed.TRUST_PROXY),
    allowedHosts,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    headersTimeoutMs: parsed.HEADERS_TIMEOUT_MS,
    keepAliveTimeoutMs: parsed.KEEP_ALIVE_TIMEOUT_MS,
    auth: {
      mode: parsed.AUTH_MODE,
      allowSecretWrites: parsed.ALLOW_SECRET_WRITES,
      sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
      sessionDbPath: path.resolve(repositoryRoot, parsed.SESSION_DB_PATH),
      ...(parsed.SECRET_KEY === undefined ? {} : { secretKey: parsed.SECRET_KEY }),
      ...(parsed.SESSION_SECRET === undefined ? {} : { sessionSecret: parsed.SESSION_SECRET }),
      ...(parsed.SESSION_ENCRYPTION_KEY === undefined
        ? {}
        : { sessionEncryptionKey: parsed.SESSION_ENCRYPTION_KEY }),
    },
    ...(github === undefined ? {} : { github }),
    langfuse: {
      enabled: parsed.LANGFUSE_ENABLED,
      environment: parsed.LANGFUSE_ENVIRONMENT,
      ...(parsed.LANGFUSE_PUBLIC_KEY === undefined
        ? {}
        : { publicKey: parsed.LANGFUSE_PUBLIC_KEY }),
      ...(parsed.LANGFUSE_SECRET_KEY === undefined
        ? {}
        : { secretKey: parsed.LANGFUSE_SECRET_KEY }),
      ...(parsed.LANGFUSE_BASE_URL === undefined ? {} : { baseUrl: parsed.LANGFUSE_BASE_URL }),
      ...(parsed.LANGFUSE_RELEASE === undefined ? {} : { release: parsed.LANGFUSE_RELEASE }),
    },
    gitSha: parsed.APP_GIT_SHA,
    warnings,
  };
}
