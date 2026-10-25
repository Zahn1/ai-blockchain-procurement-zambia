#!/usr/bin/env bash
# Runs the Caliper benchmark against the running network and saves the HTML report to docs/phase6/caliper-report.html.
# Run from the repository through the ~/procurement symlink (Fabric tooling dislikes paths with spaces).
set -e
cd "$(dirname "$0")"
export PATH="${NVM_DIR:-$HOME/.nvm}/versions/node/v20.20.2/bin:$PATH"
KEY=$(ls ../network/zambia/organizations/peerOrganizations/zppa.example.com/users/officer1@zppa.example.com/msp/keystore/*_sk | head -1)
sed "s|KEY_PATH|$KEY|" networks/network.template.yaml > networks/network.yaml
npx caliper launch manager \
  --caliper-workspace ./ \
  --caliper-networkconfig networks/network.yaml \
  --caliper-benchconfig benchmarks/procurement.yaml \
  --caliper-flow-only-test \
  --caliper-report-path ../docs/phase6/caliper-report.html
