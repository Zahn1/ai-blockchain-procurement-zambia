#!/usr/bin/env bash
# Starts the whole prototype for a demonstration, e.g. after the laptop has restarted:
# Colima (Docker), the Fabric network, PostgreSQL and IPFS, then the AI service, Mailpit, the back end and the front end.
# Anything already running is left alone. Logs go to logs/. Stop the services with scripts/stop-demo.sh.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"
export PATH="${NVM_DIR:-$HOME/.nvm}/versions/node/v20.20.2/bin:$PATH"

step() { printf '\n== %s\n' "$1"; }
listening() { lsof -iTCP:"$1" -sTCP:LISTEN -n -P >/dev/null 2>&1; }
start() { # name port directory command...
  local name=$1 port=$2 dir=$3; shift 3
  if listening "$port"; then echo "$name already running on port $port"; return; fi
  (cd "$dir" && nohup "$@" >"$LOGS/$name.log" 2>&1 & echo $! >"$LOGS/$name.pid")
  echo "$name starting on port $port (log: logs/$name.log)"
}
wait_for() { # name url
  for _ in $(seq 1 60); do curl -fs -o /dev/null "$2" && { echo "  ok   $1"; return 0; }; sleep 1; done
  echo "  FAIL $1 did not answer at $2 (see logs/)"; return 1
}

step "Docker (Colima)"
if colima status >/dev/null 2>&1; then echo "Colima already running"; else colima start --dns 1.1.1.1 --dns 8.8.8.8; fi
docker context use colima >/dev/null 2>&1

step "Fabric network: certificate authorities, orderer and the ZPPA and OAG peers"
docker start ca_zppa ca_oag ca_orderer orderer.example.com peer0.zppa.example.com peer0.oag.example.com >/dev/null && echo "started"

step "PostgreSQL and IPFS"
docker compose -f "$ROOT/infra/docker-compose.yml" up -d 2>&1 | tail -2

step "Services"
start ai-service 8000 "$ROOT/ai" .venv/bin/uvicorn service.app:app --host 127.0.0.1 --port 8000
start mailpit 8025 "$ROOT" mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025
sleep 5 # let the peers and databases come up before the back end connects
start back-end 3000 "$ROOT/backend" node src/server.js
start front-end 5173 "$ROOT/frontend" node node_modules/vite/bin/vite.js --port 5173 --strictPort

step "Checking"
ok=0
wait_for "AI risk service" http://127.0.0.1:8000/health || ok=1
wait_for "Mailpit inbox" http://127.0.0.1:8025/ || ok=1
wait_for "Back end and ledger" http://localhost:3000/api/tenders || ok=1
wait_for "Front end" http://localhost:5173/ || ok=1

if [ $ok -eq 0 ]; then
  printf '\nReady.\n  Prototype:      http://localhost:5173\n  Public portal:  http://localhost:5173/public\n  E-mail inbox:   http://127.0.0.1:8025\n'
else
  printf '\nSomething did not start. Check the logs in %s\n' "$LOGS"
  exit 1
fi
