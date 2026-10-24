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
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'node:url';
import { pacraStandIn, zraStandIn, ifmisStandIn, smsStandIn } from './standins/services.js';
import { createNotifier, smsClient } from './notify.js';
import { ifmisClient } from './ifmis.js';
import { aiClient, createRisk } from './risk.js';

const receiptSigner = async () => {
  const { privateKey, cert } = await ledger.loadIdentity(actors.gateway);
  return [privateKey, cert];
};

const db = new PrismaClient();
const auth = createAuth({ db, jwtSecret: process.env.JWT_SECRET, appKey: process.env.APP_KEY });

const registries = registryClients({ pacraUrl: config.pacraUrl, zraUrl: config.zraUrl });

const ifmis = ifmisClient({ url: config.ifmisUrl });
const notifier = createNotifier({ db, from: config.mailFrom, sms: smsClient({ url: config.smsUrl }),
  mailer: nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: false }) });

const risk = createRisk({ db, ledger, auth, ai: aiClient({ url: config.aiUrl }), aiIdentity: actors.ai, officerIdentity: actors.officer });

const app = createApp({ ledger, ipfs, store: dbStore(db), keys, receiptSigner, db, auth, registries, ifmis, notifier, risk });
// Stand-in PACRA and ZRA services (3.5.2), reached by the back end over HTTP like the real ones
app.use('/stand-in/pacra', pacraStandIn());
app.use('/stand-in/zra', zraStandIn());
app.use('/stand-in/ifmis', ifmisStandIn({ file: fileURLToPath(new URL('../data/ifmis-standin.json', import.meta.url)) })); // 3.5.6
app.use('/stand-in/sms', smsStandIn()); // 3.5.10
const server = app.listen(config.port, () => {
  console.log(`Procurement prototype on http://localhost:${config.port}`);
});

const stop = async () => { server.close(); await notifier.flush(); ledger.close(); db.$disconnect(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
