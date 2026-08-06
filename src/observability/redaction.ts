import { createHash } from 'node:crypto';

const redacted = '[REDACTED]';
const omitted = '[OMITTED]';

const secretKeyPattern =
  /(?:^|[_-])(authorization|cookie|password|secret|access[_-]?token|refresh[_-]?token|bearer[_-]?token|session[_-]?token|client[_-]?secret|private[_-]?key|oauth[_-]?code|code[_-]?verifier|pkce)(?:$|[_-])/i;
const contentKeyPattern =
  /(?:^|[_-])(content|document|raw[_-]?body|proposed[_-]?content|file[_-]?body)(?:$|[_-])/i;
const bearerPattern = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const tokenPattern = /\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const privateKeyPattern = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;

export function hashForTelemetry(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function redactString(value: string): string {
  return value
    .replace(privateKeyPattern, redacted)
    .replace(bearerPattern, 'Bearer [REDACTED]')
    .replace(tokenPattern, redacted);
}

export function redact(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) result[key] = redacted;
    else if (contentKeyPattern.test(key)) result[key] = omitted;
    else result[key] = redact(entry, seen);
  }
  return result;
}

export function safeTelemetryMetadata(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return redact(value) as Readonly<Record<string, unknown>>;
}
