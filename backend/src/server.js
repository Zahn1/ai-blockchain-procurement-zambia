// Starts the prototype: API plus the web pages in public/.
import { createApp } from './app.js';
import { config, actors } from './config.js';
import * as ledger from './fabric.js';
import * as ipfs from './ipfs.js';
import * as keys from './sealed.js';
import { dbStore } from './store.js';
import { PrismaClient } from '@prisma/client';
import { createAuth } from './auth.js';
import { registryClients } from './registries.js';
import { pacraStandIn, zraStandIn } from './standins/services.js';

const receiptSigner = async () => {
  const { privateKey, cert } = await ledger.loadIdentity(actors.gateway);
  return [privateKey, cert];
};

const db = new PrismaClient();
const auth = createAuth({ db, jwtSecret: process.env.JWT_SECRET, appKey: process.env.APP_KEY });

const registries = registryClients({ pacraUrl: config.pacraUrl, zraUrl: config.zraUrl });

const app = createApp({ ledger, ipfs, store: dbStore(db), keys, receiptSigner, db, auth, registries });
// Stand-in PACRA and ZRA services (3.5.2), reached by the back end over HTTP like the real ones
app.use('/stand-in/pacra', pacraStandIn());
app.use('/stand-in/zra', zraStandIn());
const server = app.listen(config.port, () => {
  console.log(`Procurement prototype on http://localhost:${config.port}`);
});

const stop = () => { server.close(); ledger.close(); db.$disconnect(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
