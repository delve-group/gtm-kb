import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_VERSION = 'v1';

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function safeSignatureEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) {
    return cookies;
  }

  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    cookies.set(name, value);
  }
  return cookies;
}

export interface BrowserSessionCookieOptions {
  secret: string;
  publicBaseUrl: string;
  name?: string;
  maxAgeSeconds?: number;
}

export class BrowserSessionCookie {
  readonly name: string;
  readonly secure: boolean;
  readonly #secret: string;
  readonly #maxAgeSeconds: number | undefined;

  constructor(options: BrowserSessionCookieOptions) {
    if (options.secret.length < 32) {
      throw new TypeError('SESSION_SECRET must be at least 32 characters.');
    }

    const publicBaseUrl = new URL(options.publicBaseUrl);
    if (publicBaseUrl.protocol !== 'http:' && publicBaseUrl.protocol !== 'https:') {
      throw new TypeError('PUBLIC_BASE_URL must use http or https.');
    }

    this.name = options.name ?? 'company_brain_session';
    this.secure = publicBaseUrl.protocol === 'https:';
    this.#secret = options.secret;
    this.#maxAgeSeconds = options.maxAgeSeconds;
  }

  sign(sessionId: string): string {
    if (sessionId.length === 0) {
      throw new TypeError('Session ID must not be empty.');
    }
    const payload = base64UrlEncode(sessionId);
    const unsigned = `${COOKIE_VERSION}.${payload}`;
    const signature = createHmac('sha256', this.#secret).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
  }

  verify(signedValue: string): string | null {
    const [version, payload, signature, extra] = signedValue.split('.');
    if (
      version !== COOKIE_VERSION ||
      payload === undefined ||
      signature === undefined ||
      extra !== undefined
    ) {
      return null;
    }

    const unsigned = `${version}.${payload}`;
    const expected = createHmac('sha256', this.#secret).update(unsigned).digest('base64url');
    if (!safeSignatureEqual(signature, expected)) {
      return null;
    }
    return base64UrlDecode(payload);
  }

  read(cookieHeader: string | undefined): string | null {
    const value = parseCookies(cookieHeader).get(this.name);
    return value === undefined ? null : this.verify(value);
  }

  serialize(sessionId: string): string {
    const attributes = [
      `${this.name}=${this.sign(sessionId)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (this.secure) {
      attributes.push('Secure');
    }
    if (this.#maxAgeSeconds !== undefined) {
      attributes.push(`Max-Age=${String(Math.max(0, Math.floor(this.#maxAgeSeconds)))}`);
    }
    return attributes.join('; ');
  }

  clear(): string {
    const attributes = [`${this.name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (this.secure) {
      attributes.push('Secure');
    }
    return attributes.join('; ');
  }
}
