import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProposalRecord } from '../github/index.js';
import { SqliteProposalStore } from './sqlite-proposal-store.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function proposal(): ProposalRecord {
  return {
    id: '5d9286c7-9945-4878-b8b4-1d755e23e74a',
    actor: { githubUserId: 1, githubLogin: 'octocat' },
    owner: 'owner',
    repository: 'brain',
    defaultBranch: 'main',
    baseSha: 'a'.repeat(40),
    title: 'Update positioning',
    rationale: 'Keep the current story accurate.',
    changes: [{ operation: 'update', path: 'brain/strategy/positioning.md' }],
    createdAt: '2026-08-06T12:00:00.000Z',
    updatedAt: '2026-08-06T12:00:00.000Z',
    status: 'preparing',
  };
}

describe('SqliteProposalStore', () => {
  it('persists UUID and pull-request lookups across store instances', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'brain-proposals-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'sessions.sqlite');
    const first = new SqliteProposalStore(databasePath);
    const record = proposal();
    await first.create(record);
    await first.update(record.id, {
      status: 'pr_opened',
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/owner/brain/pull/42',
      updatedAt: '2026-08-06T12:01:00.000Z',
    });
    first.close();

    const second = new SqliteProposalStore(databasePath);
    expect((await second.getByPullRequestNumber(42))?.id).toBe(record.id);
    expect((await second.getById(record.id))?.status).toBe('pr_opened');
    second.close();
  });
});
