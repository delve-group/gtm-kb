import { redact } from './redaction.js';

export interface Logger {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export function createLogger(options: { environment: string; service?: string }): Logger {
  const service = options.service ?? 'company-brain';

  function write(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    if (level === 'debug' && options.environment === 'production') return;
    const record = redact({
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...fields,
    });
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}
