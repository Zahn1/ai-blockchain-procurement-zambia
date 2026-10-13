#!/usr/bin/env bash
# Starts the prototype on http://localhost:3000 with Node 20. Needs the Fabric network and infra (IPFS) running.
cd "$(dirname "$0")"
NODE="${NVM_DIR:-$HOME/.nvm}/versions/node/v20.20.2/bin/node"
[ -x "$NODE" ] || NODE=node
exec "$NODE" src/server.js
