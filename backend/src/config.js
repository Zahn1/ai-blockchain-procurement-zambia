// Settings for the prototype back end. Defaults match the local ZPPA/OAG network and infra/docker-compose.yml.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');

// Local secrets and the database address come from backend/.env (not committed; see .env.example)
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // no .env: rely on the real environment (as in CI)
}

// Fabric scripts break on paths with spaces, so the network is reached through the ~/procurement symlink.
const networkDir = process.env.FABRIC_NETWORK_DIR
  ?? path.join(process.env.HOME, 'procurement', 'network', 'zambia');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  channel: process.env.FABRIC_CHANNEL ?? 'procurement',
  chaincode: process.env.FABRIC_CHAINCODE ?? 'procurement',
  peer: {
    endpoint: process.env.FABRIC_PEER ?? 'localhost:7051',
    hostAlias: 'peer0.zppa.example.com',
    tlsCert: path.join(networkDir, 'organizations/peerOrganizations/zppa.example.com/peers/peer0.zppa.example.com/tls/ca.crt'),
  },
  mspId: 'ZPPAMSP',
  usersDir: path.join(networkDir, 'organizations/peerOrganizations/zppa.example.com/users'),
  ipfsApi: process.env.IPFS_API ?? 'http://127.0.0.1:5001',
  // PACRA and ZRA: the stand-ins run inside this server; point these at the real services to replace them
  pacraUrl: process.env.PACRA_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/stand-in/pacra`,
  zraUrl: process.env.ZRA_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/stand-in/zra`,
  ifmisUrl: process.env.IFMIS_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/stand-in/ifmis`,
  // Notifications (3.5.10): e-mail through SMTP (Mailpit in development), SMS through the gateway stand-in
  smsUrl: process.env.SMS_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/stand-in/sms`,
  smtp: { host: process.env.SMTP_HOST ?? '127.0.0.1', port: Number(process.env.SMTP_PORT ?? 1025) },
  mailFrom: process.env.MAIL_FROM ?? 'ZPPA e-Procurement <no-reply@zppa.test>',
  dataDir: process.env.DATA_DIR ?? path.join(root, 'data'),
};

// Which enrolled user the back end acts as for each action. Each certificate carries its role (see registerEnroll.sh).
export const actors = {
  officer: 'officer1',
  gateway: 'gateway',
};

// Ledger identities enrolled for evaluation committee members (registerEnroll.sh). Each committee user gets
// one of their own, so every opening approval carries that member's own digital signature (3.5.5).
export const committeeIdentities = (process.env.COMMITTEE_IDENTITIES ?? 'committee1,committee2').split(',');

// Ledger identities enrolled for inspectors, who sign milestone completion certificates (3.5.6).
export const inspectorIdentities = (process.env.INSPECTOR_IDENTITIES ?? 'inspector1,inspector2').split(',');

// Ledger identities enrolled for regulators, who sign their alert decisions (3.5.8).
export const regulatorIdentities = (process.env.REGULATOR_IDENTITIES ?? 'regulator1,regulator2').split(',');
