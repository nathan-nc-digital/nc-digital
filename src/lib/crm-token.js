import { crmError, stateGet, stateSet, acquireLock, releaseLock } from './crm.js';

const CACHE_KEY = 'zoho_access_token';
const encoder = new TextEncoder();

async function encryptionKey(env) {
  // High-entropy OAuth secrets bind the encrypted cache to this exact connection.
  const material = JSON.stringify(['nc-digital-zoho-token-v1', env.ZOHO_REGION, env.ZOHO_ACCOUNT_ID, env.ZOHO_CLIENT_ID, env.ZOHO_CLIENT_SECRET, env.ZOHO_REFRESH_TOKEN]);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(material));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function base64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function bytes(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }

async function readToken(db, key) {
  const value = await stateGet(db, CACHE_KEY);
  if (!value) return null;
  try {
    const envelope = JSON.parse(value);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv) }, key, bytes(envelope.data));
    const cached = JSON.parse(new TextDecoder().decode(plaintext));
    if (typeof cached.token !== 'string' || !cached.token || cached.expiresAt <= Date.now() + 60000 || !Number.isFinite(cached.expiresAt)) return null;
    return cached.token;
  } catch { return null; } // Rotated credentials, invalid cache or tampering require a new token.
}

export async function cachedZohoToken(env, refresh) {
  if (!env.JOBS_DB) return (await refresh()).access_token;
  const db = env.JOBS_DB;
  const key = await encryptionKey(env);
  const cached = await readToken(db, key);
  if (cached) return cached;
  const owner = await acquireLock(db, 'zoho_token_lock', 45);
  if (!owner) throw crmError('Zoho authorisation is being refreshed. Please try again shortly.', 503);
  try {
    const current = await readToken(db, key);
    if (current) return current;
    const issuedAt = Date.now();
    const token = await refresh();
    if (typeof token.access_token !== 'string' || !token.access_token) throw crmError('Zoho did not issue an access token.', 502);
    // Zoho access tokens last one hour; honour shorter advertised lifetimes too.
    const ttl = Math.min(3600, Number(token.expires_in) || 3600);
    if (ttl > 60) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify({ token: token.access_token, expiresAt: issuedAt + ttl * 1000 })));
      await stateSet(db, CACHE_KEY, JSON.stringify({ iv: base64(iv), data: base64(ciphertext) }));
    }
    return token.access_token;
  } finally { await releaseLock(db, 'zoho_token_lock', owner); }
}
