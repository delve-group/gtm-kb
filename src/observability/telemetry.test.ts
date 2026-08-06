import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './logger.js';
import {
  SafeLangfuseTelemetry,
  type ObservationRunner,
  type ObservationSpan,
} from './telemetry.js';

function logger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function telemetry(runner: ObservationRunner): SafeLangfuseTelemetry {
  return new SafeLangfuseTelemetry(
    { forceFlush: () => Promise.resolve() },
    { shutdown: () => Promise.resolve() },
    logger(),
    runner,
  );
}

const span: ObservationSpan = { update: vi.fn() };

describe('SafeLangfuseTelemetry', () => {
  it('records a nested execution graph', async () => {
    const stack: string[] = [];
    const graph: { name: string; parent: string | null }[] = [];
    const runner: ObservationRunner = async (name, callback) => {
      graph.push({ name, parent: stack.at(-1) ?? null });
      stack.push(name);
      try {
        return await callback(span);
      } finally {
        stack.pop();
      }
    };
    const tracing = telemetry(runner);

    await tracing.observe('mcp.tool.brain_propose_change', {}, async () =>
      tracing.observe('auth.authenticate', {}, async () =>
        tracing.observe('brain.validate', {}, () => Promise.resolve('ok')),
      ),
    );

    expect(graph).toEqual([
      { name: 'mcp.tool.brain_propose_change', parent: null },
      { name: 'auth.authenticate', parent: 'mcp.tool.brain_propose_change' },
      { name: 'brain.validate', parent: 'auth.authenticate' },
    ]);
  });

  it('runs the operation once when telemetry fails before or after the callback', async () => {
    const beforeOperation = vi.fn(() => Promise.resolve('before-ok'));
    const before = telemetry(() => Promise.reject(new Error('collector unavailable')));
    await expect(before.observe('brain.search', {}, beforeOperation)).resolves.toBe('before-ok');
    expect(beforeOperation).toHaveBeenCalledOnce();

    const afterOperation = vi.fn(() => Promise.resolve('after-ok'));
    const after = telemetry(async (_name, callback) => {
      await callback(span);
      throw new Error('export failed');
    });
    await expect(after.observe('brain.search', {}, afterOperation)).resolves.toBe('after-ok');
    expect(afterOperation).toHaveBeenCalledOnce();
  });

  it('never retries or hides a business-operation failure', async () => {
    const expected = new Error('business failure');
    const operation = vi.fn(() => Promise.reject(expected));
    const tracing = telemetry((_name, callback) => callback(span));
    await expect(tracing.observe('github.create_branch', {}, operation)).rejects.toBe(expected);
    expect(operation).toHaveBeenCalledOnce();
  });
});
