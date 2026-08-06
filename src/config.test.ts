import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('loads a local secret-only configuration without GitHub', () => {
    const config = loadConfig(
      {
        NODE_ENV: 'test',
        AUTH_MODE: 'secret',
        SECRET_KEY: 'test-secret',
        LANGFUSE_ENABLED: 'false',
      },
      '/workspace',
    );

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.brainRoot).toBe('/workspace/brain');
    expect(config.auth.allowSecretWrites).toBe(false);
  });

  it('always derives the GitHub callback from PUBLIC_BASE_URL', () => {
    const config = loadConfig(
      {
        NODE_ENV: 'production',
        AUTH_MODE: 'github',
        PUBLIC_BASE_URL: 'https://brain.example.com',
        SESSION_SECRET: 's'.repeat(32),
        SESSION_ENCRYPTION_KEY: 'a'.repeat(64),
        GITHUB_APP_ID: '1',
        GITHUB_CLIENT_ID: 'client',
        GITHUB_CLIENT_SECRET: 'secret',
        GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
        GITHUB_INSTALLATION_ID: '2',
        GITHUB_REPOSITORY: 'superseller/company-brain',
        LANGFUSE_ENABLED: 'false',
        TRUST_PROXY: '1',
      },
      '/workspace',
    );

    expect(config.github?.callbackUrl.href).toBe('https://brain.example.com/auth/github/callback');
    expect(config.github?.privateKey).toContain('\nkey\n');
    expect(config.trustProxy).toBe(1);
    expect(config.allowedHosts).toEqual(['brain.example.com', '127.0.0.1', 'localhost', '[::1]']);
  });

  it('names missing variables without exposing values', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'github' }, '/workspace')).toThrow(
      /PUBLIC_BASE_URL.*SESSION_SECRET.*GITHUB_APP_ID/,
    );
  });

  it('rejects insecure or path-bearing production callback bases', () => {
    const githubEnvironment = {
      NODE_ENV: 'production',
      AUTH_MODE: 'github',
      SESSION_SECRET: 's'.repeat(32),
      SESSION_ENCRYPTION_KEY: 'a'.repeat(64),
      GITHUB_APP_ID: '1',
      GITHUB_CLIENT_ID: 'client',
      GITHUB_CLIENT_SECRET: 'secret',
      GITHUB_APP_PRIVATE_KEY: 'private-key',
      GITHUB_INSTALLATION_ID: '2',
      GITHUB_REPOSITORY: 'superseller/company-brain',
      LANGFUSE_ENABLED: 'false',
    };

    expect(() =>
      loadConfig(
        { ...githubEnvironment, PUBLIC_BASE_URL: 'http://brain.example.com' },
        '/workspace',
      ),
    ).toThrow(/must use https/);
    expect(() =>
      loadConfig(
        { ...githubEnvironment, PUBLIC_BASE_URL: 'https://brain.example.com/internal' },
        '/workspace',
      ),
    ).toThrow(/without credentials or a path/);
  });
});
