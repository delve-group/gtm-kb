import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSecretActor } from '../auth/index.js';
import { BrainKernel } from '../brain/index.js';
import type { Logger } from '../observability/index.js';
import { createTelemetry } from '../observability/index.js';
import { createCompanyBrainMcpServer } from './server.js';

describe('Company Brain MCP integration', () => {
  const secret = 'integration-test-shared-secret';
  const repositoryRoot = path.resolve(import.meta.dirname, '../..');
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const actor = createSecretActor({ repository: 'local/company-brain' });
  const authInfo: AuthInfo = {
    token: secret,
    clientId: 'integration-test',
    scopes: ['brain:read'],
    extra: { actor },
  };
  let client: Client;
  let handler: ReturnType<typeof createMcpHandler>;
  let authenticatedFetch: typeof fetch;

  beforeAll(async () => {
    const brain = new BrainKernel({
      rootDir: path.join(repositoryRoot, 'brain'),
      repositoryRoot,
    });
    await brain.refresh();
    const telemetry = createTelemetry({ enabled: false, environment: 'test' }, logger);
    handler = createMcpHandler((context) => {
      const requestActor = context.authInfo?.extra?.actor;
      if (!requestActor || typeof requestActor !== 'object') throw new Error('Unauthenticated');
      return createCompanyBrainMcpServer(
        {
          brain,
          telemetry,
          gitSha: 'test-sha',
          configurationWarnings: [],
          githubConnectivity: () => Promise.resolve({ status: 'disabled' }),
        },
        { actor: requestActor as typeof actor },
      );
    });
    authenticatedFetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.headers.get('authorization') !== `Bearer ${secret}`) {
        return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
        });
      }
      return handler.fetch(request, { authInfo });
    };
    const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      authProvider: { token: () => Promise.resolve(secret) },
      fetch: authenticatedFetch,
    });
    client = new Client(
      { name: 'company-brain-integration-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    await handler.close();
  });

  it('rejects a request without a bearer token', async () => {
    const response = await authenticatedFetch('http://test.local/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  it('lists all tools and searches the real Company Brain through an MCP client', async () => {
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      'brain_context_pack',
      'brain_get',
      'brain_get_proposal',
      'brain_health',
      'brain_list_domains',
      'brain_propose_change',
      'brain_search',
      'brain_validate',
    ]);

    const result = await client.callTool({
      name: 'brain_search',
      arguments: { query: 'LinkedIn campaign', limit: 5 },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: true });
    const output = result.structuredContent as { data: unknown[] };
    expect(output.data.length).toBeGreaterThan(0);
  });

  it('never lets a shared-secret actor impersonate a GitHub proposal author', async () => {
    const result = await client.callTool({
      name: 'brain_propose_change',
      arguments: {
        base_sha: 'a'.repeat(40),
        title: 'Test proposal',
        rationale: 'Ensure the write boundary is enforced.',
        changes: [
          {
            operation: 'update',
            path: 'brain/company/identity.md',
            content: 'exact content',
          },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'FORBIDDEN' },
    });
  });
});
