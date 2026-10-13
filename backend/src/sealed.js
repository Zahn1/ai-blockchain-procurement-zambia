// Sealed bids: AES-256-GCM encryption, SHA-256 hashing and storage of the per-bid keys.
//
// Each bid gets its own random 256-bit key. The key is itself encrypted ("wrapped") with a master key and kept
// off-chain until opening. Prototype limitation: one master key held by the back end. The design's stretch goal
// replaces it with Shamir secret sharing among committee members, so no single party can open a bid.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const IV_BYTES = 12; // recommended nonce size for GCM
const TAG_BYTES = 16;

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Encrypts with AES-256-GCM. Output layout: iv (12 bytes) | auth tag (16 bytes) | ciphertext. */
export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Decrypts; throws if the data or key has been tampered with (GCM authentication). */
export function decrypt(sealed, key) {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export const newKey = () => crypto.randomBytes(32);

async function masterKey() {
  if (process.env.BID_MASTER_KEY) return Buffer.from(process.env.BID_MASTER_KEY, 'hex');
  const file = path.join(config.dataDir, 'master.key');
  try {
    return Buffer.from((await fs.readFile(file, 'utf8')).trim(), 'hex');
  } catch {
    const key = newKey();
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(file, key.toString('hex'), { mode: 0o600 });
    return key;
  }
}

const keysFile = () => path.join(config.dataDir, 'bid-keys.json');

async function readKeys() {
  try {
    return JSON.parse(await fs.readFile(keysFile(), 'utf8'));
  } catch {
    return {};
  }
}

/** Stores a bid's key, wrapped with the master key. */
export async function storeBidKey(bidId, key) {
  const keys = await readKeys();
  keys[bidId] = encrypt(key, await masterKey()).toString('base64');
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(keysFile(), JSON.stringify(keys, null, 2), { mode: 0o600 });
}

/** Returns a bid's key (needed only at opening). */
export async function loadBidKey(bidId) {
  const wrapped = (await readKeys())[bidId];
  if (!wrapped) throw new Error(`no key stored for bid ${bidId}`);
  return decrypt(Buffer.from(wrapped, 'base64'), await masterKey());
}
