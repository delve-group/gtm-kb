import type { ProposalRecord, ProposalStore } from './types.js';

/** A small utility for tests and local adapters. Production can inject a SQLite-backed store. */
export class InMemoryProposalStore implements ProposalStore {
  readonly #records = new Map<string, ProposalRecord>();

  create(record: ProposalRecord): Promise<void> {
    if (this.#records.has(record.id)) {
      throw new Error('Proposal already exists');
    }
    this.#records.set(record.id, structuredClone(record));
    return Promise.resolve();
  }

  update(id: string, patch: Partial<ProposalRecord>): Promise<void> {
    const current = this.#records.get(id);
    if (!current) {
      throw new Error('Proposal does not exist');
    }

    this.#records.set(
      id,
      structuredClone({
        ...current,
        ...patch,
        id: current.id,
      }),
    );
    return Promise.resolve();
  }

  getById(id: string): Promise<ProposalRecord | undefined> {
    const record = this.#records.get(id);
    return Promise.resolve(record ? structuredClone(record) : undefined);
  }

  getByPullRequestNumber(number: number): Promise<ProposalRecord | undefined> {
    for (const record of this.#records.values()) {
      if (record.pullRequestNumber === number) {
        return Promise.resolve(structuredClone(record));
      }
    }
    return Promise.resolve(undefined);
  }
}
