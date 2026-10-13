// Signed bid receipts (Chapter 3, 3.5.4): the back end signs each receipt with the gateway identity's private key,
// the same key that signed the ledger transaction. Anyone with the gateway certificate can check the signature.
import crypto from 'node:crypto';

const FIELDS = ['bidId', 'tenderId', 'supplierRef', 'cipherHash', 'cid', 'submittedAt', 'txId', 'block'];

/** Fixed field order, so the signed bytes are the same wherever the receipt is checked. */
export const canonical = (receipt) => JSON.stringify(FIELDS.map((f) => [f, receipt[f] ?? null]));

export function sign(receipt, privateKey, certPem) {
  const signature = crypto.sign('sha256', Buffer.from(canonical(receipt)), privateKey).toString('base64');
  return { ...receipt, signature, signer: 'gateway@zppa.example.com', signerCert: certPem.toString() };
}

export function verify(signed) {
  try {
    const key = new crypto.X509Certificate(signed.signerCert).publicKey;
    return crypto.verify('sha256', Buffer.from(canonical(signed)), key, Buffer.from(signed.signature, 'base64'));
  } catch {
    return false;
  }
}
