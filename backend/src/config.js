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
  dataDir: process.env.DATA_DIR ?? path.join(root, 'data'),
};

// Which enrolled user the back end acts as for each action. Each certificate carries its role (see registerEnroll.sh).
export const actors = {
  officer: 'officer1',
  gateway: 'gateway',
};
