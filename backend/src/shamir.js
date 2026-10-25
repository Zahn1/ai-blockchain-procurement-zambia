// Shamir key splitting for bid opening (FR-BID-07, a stretch goal of 3.5.5).
//
// When the committee is appointed, the tender gets an X25519 key pair. Each bid's AES key is wrapped with the public
// key (ECIES: ephemeral X25519 + HKDF-SHA256 + AES-256-GCM). The private key is split with Shamir's secret sharing
// into one share per member, any `quorum` of which rebuild it, and is then destroyed. Each member downloads their
// share once; at opening, at least the quorum hand theirs back. Only then can the back end rebuild the private key,
// in memory, to unwrap the bid keys. Splitting uses shamir-secret-sharing (Privy; independently audited).
import crypto from 'node:crypto';
import { split, combine } from 'shamir-secret-sharing';
import { sha256 } from './sealed.js';

const PREFIX = 'ZPPA-SHARE';
const INFO = Buffer.from('zppa bid key wrap v1');

/** A new tender key pair: the public key (base64 DER) to keep, and the private key (DER bytes) to split. */
export function tenderKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }),
  };
}

function kek(shared, salt) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, salt, INFO, 32));
}

/** Wraps a bid key for the tender's public key. Output (base64): ephemeral public key DER | iv | tag | ciphertext. */
export function wrapKey(bidKey, publicKeyB64) {
  const recipient = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
  const eph = crypto.generateKeyPairSync('x25519');
  const ephDer = eph.publicKey.export({ type: 'spki', format: 'der' });
  const key = kek(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), ephDer);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(bidKey), cipher.final()]);
  return Buffer.concat([Buffer.from([ephDer.length]), ephDer, iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Unwraps a bid key with the rebuilt private key (DER bytes). Throws if the key is wrong or the data altered. */
export function unwrapKey(wrappedB64, privateKeyDer) {
  const data = Buffer.from(wrappedB64, 'base64');
  const n = data[0];
  const ephDer = data.subarray(1, 1 + n);
  const iv = data.subarray(1 + n, 13 + n);
  const tag = data.subarray(13 + n, 29 + n);
  const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const eph = crypto.createPublicKey({ key: ephDer, format: 'der', type: 'spki' });
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek(crypto.diffieHellman({ privateKey, publicKey: eph }), ephDer), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(29 + n)), decipher.final()]);
}

/** Splits the private key into `count` shares, any `threshold` of which rebuild it. Returns share texts. */
export async function splitKey(privateKeyDer, count, threshold, reference) {
  const shares = await split(new Uint8Array(privateKeyDer), count, threshold);
  return shares.map((s, i) => `${PREFIX}:${reference}:${i + 1}:${Buffer.from(s).toString('base64')}`);
}

/** Reads a share text. Returns { reference, index, bytes } or throws with a message a member can act on. */
export function parseShare(text) {
  const m = /^ZPPA-SHARE:(.+):(\d+):([A-Za-z0-9+/=]+)$/.exec(String(text ?? '').trim());
  if (!m) throw new Error('That is not a key share. Paste the whole line you downloaded, starting with ZPPA-SHARE.');
  return { reference: m[1], index: Number(m[2]), bytes: Buffer.from(m[3], 'base64') };
}

export const shareHash = (text) => sha256(String(text).trim());

/**
 * Rebuilds the private key from share texts and checks it against the tender's public key, because combining too few
 * or wrong shares does not fail by itself: it quietly gives a different key.
 */
export async function combineShares(texts, publicKeyB64) {
  const der = Buffer.from(await combine(texts.map((t) => new Uint8Array(parseShare(t).bytes))));
  let matches = false;
  try {
    const pub = crypto.createPublicKey(crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }))
      .export({ type: 'spki', format: 'der' }).toString('base64');
    matches = pub === publicKeyB64;
  } catch { /* not a valid key at all */ }
  if (!matches) throw new Error('The key shares do not rebuild this tender\'s opening key.');
  return der;
}
