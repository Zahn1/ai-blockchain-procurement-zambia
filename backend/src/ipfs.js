// Minimal client for the IPFS kubo RPC API (infra/docker-compose.yml), using Node's built-in fetch.
import { config } from './config.js';

/** Adds a file to IPFS and pins it. Returns its content identifier (CID). */
export async function add(bytes, filename = 'file') {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  const res = await fetch(`${config.ipfsApi}/api/v0/add?cid-version=1&pin=true`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`IPFS add failed: ${res.status} ${await res.text()}`);
  return (await res.json()).Hash;
}

/** Reads a file back from IPFS. */
export async function cat(cid) {
  const res = await fetch(`${config.ipfsApi}/api/v0/cat?arg=${encodeURIComponent(cid)}`, { method: 'POST' });
  if (!res.ok) throw new Error(`IPFS cat failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
