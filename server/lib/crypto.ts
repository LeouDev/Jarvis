import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { UserFacingError } from './util.js';

// AES-256-GCM for connected-account tokens. The key lives only in server env (TOKEN_ENCRYPTION_KEY).
function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  const buf = raw ? Buffer.from(raw, 'base64') : null;
  if (buf?.length !== 32) throw new UserFacingError('TOKEN_ENCRYPTION_KEY is not set (32-byte base64) on the server, so accounts cannot be connected securely.');
  return buf;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64'))).join(':');
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(':');
  if (v !== 'v1') throw new Error('Unknown token format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
