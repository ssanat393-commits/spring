import crypto from 'node:crypto';
import { ENV } from '../config/env';

export interface SignedEnrollmentPayload {
  linkId: string;
  label: string;
  expMs: number;
  nonce: string;
}

export function createSignedEnrollmentToken(
  payload: SignedEnrollmentPayload,
  secret = ENV.SESSION_SECRET
): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySignedEnrollmentToken(
  token: string,
  secret = ENV.SESSION_SECRET,
  nowMs = Date.now()
): { valid: true; payload: SignedEnrollmentPayload } | { valid: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Malformed enrollment token.' };
  }

  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'Invalid enrollment link signature.' };
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SignedEnrollmentPayload>;
    if (!parsed.linkId || !parsed.label || typeof parsed.expMs !== 'number' || !parsed.nonce) {
      return { valid: false, reason: 'Incomplete enrollment token payload.' };
    }
    if (parsed.expMs < nowMs) {
      return { valid: false, reason: 'Enrollment link has expired.' };
    }
    return {
      valid: true,
      payload: {
        linkId: String(parsed.linkId),
        label: String(parsed.label),
        expMs: parsed.expMs,
        nonce: String(parsed.nonce),
      },
    };
  } catch {
    return { valid: false, reason: 'Unable to decode enrollment token.' };
  }
}

export function hashEnrollmentToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateShortPairingCode(): string {
  const bytes = crypto.randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `CIC-${suffix}`;
}

export function normalizePairingCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^CIC[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(cleaned)) {
    return `CIC-${cleaned.slice(3)}`;
  }
  if (/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(cleaned)) {
    return `CIC-${cleaned}`;
  }
  return null;
}
