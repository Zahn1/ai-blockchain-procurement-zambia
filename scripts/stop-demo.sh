#!/usr/bin/env bash
# Stops the services started by scripts/start-demo.sh. The Fabric network, PostgreSQL and IPFS keep running (and keep
# their data); stop them with `colima stop` if needed.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for name in front-end back-end mailpit ai-service; do
  pidfile="$ROOT/logs/$name.pid"
  if [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null; then echo "stopped $name"; else echo "$name was not started by start-demo.sh"; fi
  rm -f "$pidfile"
done
