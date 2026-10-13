// Starts the prototype: API plus the web pages in public/.
import { createApp } from './app.js';
import { config, actors } from './config.js';
import * as ledger from './fabric.js';
import * as ipfs from './ipfs.js';
import * as keys from './sealed.js';
import { fileStore } from './store.js';

const receiptSigner = async () => {
  const { privateKey, cert } = await ledger.loadIdentity(actors.gateway);
  return [privateKey, cert];
};

const app = createApp({ ledger, ipfs, store: fileStore, keys, receiptSigner });
const server = app.listen(config.port, () => {
  console.log(`Procurement prototype on http://localhost:${config.port}`);
});

const stop = () => { server.close(); ledger.close(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
