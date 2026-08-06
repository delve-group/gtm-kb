import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ProposalRecord, ProposalStore } from '../github/index.js';

export class SqliteProposalStore implements ProposalStore {
  readonly #database: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.#database = new Database(databasePath);
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('busy_timeout = 5000');
    this.#database.pragma('foreign_keys = ON');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS brain_proposals (
        id TEXT PRIMARY KEY,
        pull_request_number INTEGER UNIQUE,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS brain_proposals_updated_at
        ON brain_proposals(updated_at);
    `);
  }

  create(record: ProposalRecord): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO brain_proposals
           (id, pull_request_number, record_json, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(record.id, record.pullRequestNumber ?? null, JSON.stringify(record), record.updatedAt);
    return Promise.resolve();
  }

  async update(id: string, patch: Partial<ProposalRecord>): Promise<void> {
    const current = await this.getById(id);
    if (!current) throw new Error('Proposal receipt does not exist.');
    const record = { ...current, ...patch, id: current.id } as ProposalRecord;
    this.#database
      .prepare(
        `UPDATE brain_proposals
            SET pull_request_number = ?, record_json = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(record.pullRequestNumber ?? null, JSON.stringify(record), record.updatedAt, record.id);
  }

  getById(id: string): Promise<ProposalRecord | undefined> {
    const row = this.#database
      .prepare('SELECT record_json FROM brain_proposals WHERE id = ?')
      .get(id) as { record_json: string } | undefined;
    return Promise.resolve(row ? (JSON.parse(row.record_json) as ProposalRecord) : undefined);
  }

  getByPullRequestNumber(number: number): Promise<ProposalRecord | undefined> {
    const row = this.#database
      .prepare('SELECT record_json FROM brain_proposals WHERE pull_request_number = ?')
      .get(number) as { record_json: string } | undefined;
    return Promise.resolve(row ? (JSON.parse(row.record_json) as ProposalRecord) : undefined);
  }

  close(): void {
    this.#database.close();
  }
}
