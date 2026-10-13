// Connection to the Fabric network through the Gateway service on peer0.zppa.
// The gateway collects endorsements from both ZPPA and OAG (the chaincode's majority policy) automatically.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers } from '@hyperledger/fabric-gateway';
import { config } from './config.js';

let client;
const gateways = new Map();

async function grpcClient() {
  if (!client) {
    const tlsRootCert = await fs.readFile(config.peer.tlsCert);
    client = new grpc.Client(config.peer.endpoint, grpc.credentials.createSsl(tlsRootCert), {
      'grpc.ssl_target_name_override': config.peer.hostAlias,
    });
  }
  return client;
}

/** Loads an enrolled user's certificate and private key from the network's crypto material. */
export async function loadIdentity(user) {
  const msp = path.join(config.usersDir, `${user}@zppa.example.com`, 'msp');
  const cert = await fs.readFile(path.join(msp, 'signcerts', 'cert.pem'));
  const keyDir = path.join(msp, 'keystore');
  const [keyFile] = await fs.readdir(keyDir);
  const privateKey = crypto.createPrivateKey(await fs.readFile(path.join(keyDir, keyFile)));
  return { cert, privateKey };
}

async function contractFor(user) {
  if (!gateways.has(user)) {
    const { cert, privateKey } = await loadIdentity(user);
    const gateway = connect({
      client: await grpcClient(),
      identity: { mspId: config.mspId, credentials: cert },
      signer: signers.newPrivateKeySigner(privateKey),
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15000 }),
      submitOptions: () => ({ deadline: Date.now() + 5000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    gateways.set(user, gateway.getNetwork(config.channel).getContract(config.chaincode));
  }
  return gateways.get(user);
}

const decoder = new TextDecoder();
const parse = (bytes) => {
  const text = decoder.decode(bytes);
  return text ? JSON.parse(text) : null;
};

/** A ledger rule or access check rejected the transaction. The message comes from the chaincode. */
export class LedgerError extends Error {}

function ledgerError(err) {
  // Peers report chaincode errors in err.details; keep the most specific message
  const detail = err.details?.map((d) => d.message).find(Boolean) ?? err.message;
  const reason = detail.replace(/^.*chaincode response \d+, /, '');
  return new LedgerError(reason);
}

/** Submits a transaction as `user`, waits until it is committed, and returns the result and transaction ID. */
export async function submit(user, fn, ...args) {
  const contract = await contractFor(user);
  let commit;
  try {
    commit = await contract.submitAsync(fn, { arguments: args.map(String) });
  } catch (err) {
    throw ledgerError(err);
  }
  const status = await commit.getStatus();
  if (!status.successful) {
    throw new LedgerError(`transaction ${status.transactionId} was not committed (code ${status.code})`);
  }
  return { result: parse(commit.getResult()), txId: status.transactionId, block: Number(status.blockNumber) };
}

/** Runs a read-only query as `user`. */
export async function evaluate(user, fn, ...args) {
  const contract = await contractFor(user);
  try {
    return parse(await contract.evaluateTransaction(fn, ...args.map(String)));
  } catch (err) {
    throw ledgerError(err);
  }
}

export function close() {
  client?.close();
  client = undefined;
  gateways.clear();
}
