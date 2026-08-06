import { describe, expect, it } from 'vitest';
import { hashForTelemetry, redact } from './redaction.js';

describe('recursive redaction', () => {
  it('removes credentials and full document content at arbitrary depth', () => {
    const result = redact({
      authorization: 'Bearer top-secret',
      nested: {
        github_access_token: 'gho_abcdefghijklmnopqrstuvwxyz',
        proposed_content: 'private knowledge',
        safe: 'Bearer abc.def',
      },
    });

    expect(JSON.stringify(result)).not.toContain('top-secret');
    expect(JSON.stringify(result)).not.toContain('private knowledge');
    expect(result).toEqual({
      authorization: '[REDACTED]',
      nested: {
        github_access_token: '[REDACTED]',
        proposed_content: '[OMITTED]',
        safe: 'Bearer [REDACTED]',
      },
    });
  });

  it('uses stable hashes for safe content correlation', () => {
    expect(hashForTelemetry('same')).toBe(hashForTelemetry('same'));
    expect(hashForTelemetry('same')).not.toContain('same');
  });
});
