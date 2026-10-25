# AI and Blockchain-Based Transparent Government Procurement System for Zambia

Final-year BSc Information Technology project, ZCAS University.
**Author:** Zhaninge Chipeta (202204924)

A working prototype that makes public procurement in Zambia more transparent and harder to manipulate. It runs alongside the Zambia Public Procurement Authority's e-GP system; it does not replace it.

## What it does

- **Tamper-evident records.** A permissioned blockchain (Hyperledger Fabric) records tender, bid, award, milestone and payment events. Any change to the history shows.
- **Sealed bids.** Each bid file is encrypted with AES-256-GCM and stored on IPFS; only its hash goes on the ledger. Bids can be opened only after the closing time and approval from a quorum of the evaluation committee.
- **Explainable risk scoring.** Each tender and contract gets a risk score from a supervised model combined with an Isolation Forest. SHAP explains each flag in plain English.
- **Portals** for procurement officers, suppliers, regulators and auditors, and the public. Anyone can check a document against its hash on the ledger.

## Repository layout

| Folder | Contents |
|---|---|
| `network/` | Hyperledger Fabric 2.5 network (organisations: ZPPA and the Office of the Auditor General) |
| `chaincode/` | Go smart contracts: tenders, bids, awards, milestones and alerts |
| `backend/` | Node.js API: Fabric gateway, PostgreSQL, IPFS, authentication with TOTP |
| `ai/` | Data preparation, synthetic data and the FastAPI risk-scoring service |
| `frontend/` | React web portals |
| `infra/` | Docker Compose services: PostgreSQL 16, IPFS |
| `docs/` | Requirements, method notes and test evidence for each phase |

## Design principles

- The ledger holds only hashes, IDs, amounts and statuses; no personal or confidential data goes on-chain.
- Chaincode is deterministic: it uses the transaction timestamp, never the peer's clock.
- Every contract, API route and AI endpoint has unit tests.

## Data

Training uses public ZPPA procurement data in the Open Contracting Data Standard, from the [Open Contracting Partnership data registry](https://data.open-contracting.org/en/publication/3) (CC BY 4.0), plus synthetic data. See [`docs/phase1/data-and-labelling.md`](docs/phase1/data-and-labelling.md).

## Running locally

Requires macOS or Linux, Docker, Go 1.25+, Node.js 20 and Python 3.11.

```bash
# Infrastructure (PostgreSQL and IPFS)
cp infra/.env.example infra/.env
docker compose -f infra/docker-compose.yml up -d

# Fabric binaries, samples and images (resumable)
cd network && ./fetch-fabric.sh

# Chaincode tests
cd chaincode && go mod vendor && go test ./...
```

```bash
# Back end and portals on http://localhost:3000 (needs the Fabric network, PostgreSQL and IPFS running)
cd backend && cp .env.example .env    # then fill in the secrets
npx prisma migrate deploy && node prisma/seed.js && ./start.sh

# AI risk service on http://127.0.0.1:8000 (models are in ai/models; retrain with ai/risk/train.py or the Colab notebook)
cd ai && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/uvicorn service.app:app --port 8000

# E-mail notifications in development: Mailpit catches them at http://127.0.0.1:8025
brew install mailpit && mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025

# Front end on http://localhost:5173 (calls the back end on port 3000)
cd frontend && npm install && npm run dev
```

For a demonstration, `scripts/start-demo.sh` starts everything in one go (also after a restart) and
`docs/demo/DEMO-SCRIPT.md` walks through one procurement across every role.

```bash
# Phase 6 checks against the running system (need the demo accounts in backend/data/live, git-ignored)
cd backend
node system-test/run.mjs           # one full procurement, all ten requirements -> docs/phase6/system-test-results.md
node system-test/performance.mjs   # ledger, API and AI timings -> docs/phase6/performance.md
node system-test/privacy-scan.mjs  # searches the ledger for personal data -> docs/phase6/privacy-scan.md
cd ../benchmark && npm install && ./run.sh   # Hyperledger Caliper benchmark -> docs/phase6/caliper.md
```

Fabric's scripts do not support paths with spaces, so clone the repository to a path without them.

## Status

| Phase | Weeks | Status |
|---|---|---|
| 0 Environment set-up | 1 | Done |
| 1 Data and requirements | 1–2 | Done |
| 2 Blockchain | 2–4 | Done |
| 3 Back end | 3–5 | Done |
| 4 AI models | 3–6 | Done: supervised, Isolation Forest and graph-based models; FastAPI service |
| 5 Front end | 5–7 | Done: React screens for every role, the public portal and registration |
| 6 Testing and evaluation | 7–8 | Done except the usability sessions with participants: see [`docs/phase6/evaluation-summary.md`](docs/phase6/evaluation-summary.md) |
