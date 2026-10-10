#!/usr/bin/env bash
# Resumable alternative to install-fabric.sh for slow or unstable connections.
# Usage (from network/): ./fetch-fabric.sh
set -uo pipefail
FABRIC=2.5.16
CA=1.5.17
cd "$(dirname "$0")"

retry() { for i in $(seq 1 10); do "$@" && return 0; echo "  retry $i: $*"; sleep 5; done; return 1; }

echo "==> Binaries $FABRIC (resumable)"
if bin/configtxgen -version 2>/dev/null | grep -q "v$FABRIC"; then
  echo "  already installed"
else
  TGZ=hyperledger-fabric-darwin-arm64-$FABRIC.tar.gz
  retry curl -fL -C - --http1.1 --retry 20 --retry-all-errors -o "$TGZ" \
    "https://github.com/hyperledger/fabric/releases/download/v$FABRIC/$TGZ"
  gzip -t "$TGZ" && tar -xzf "$TGZ" && rm "$TGZ" || { echo "binary archive incomplete; re-run"; exit 1; }
fi

echo "==> fabric-samples main (sparse; samples has no per-release tags)"
if [ ! -d fabric-samples/test-network ]; then
  rm -rf fabric-samples
  retry git -c http.version=HTTP/1.1 clone --depth 1 --filter=blob:none --sparse \
    https://github.com/hyperledger/fabric-samples.git fabric-samples &&
  retry git -C fabric-samples -c http.version=HTTP/1.1 sparse-checkout set test-network asset-transfer-basic
fi
# test-network looks for bin/ and config/ inside fabric-samples
[ -d fabric-samples ] && ln -sfn ../bin fabric-samples/bin && ln -sfn ../config fabric-samples/config

echo "==> Docker images"
pull() { # name version — Docker Hub first, ghcr.io as fallback
  local src="hyperledger/fabric-$1:$2"
  docker image inspect "$src" >/dev/null 2>&1 && echo "  $src already present" ||
    retry docker pull "docker.io/$src" ||
    { retry docker pull "ghcr.io/$src" && docker tag "ghcr.io/$src" "$src"; } || return 1
  for t in "${2%.*}" latest; do docker tag "$src" "hyperledger/fabric-$1:$t"; done
}
for img in peer orderer ccenv baseos; do pull "$img" "$FABRIC"; done
pull ca "$CA"

echo "==> Done"; docker images --format '{{.Repository}}:{{.Tag}}' | grep '^hyperledger/.*:latest' |
  while read -r i; do echo "$i $(docker image inspect -f '{{.Architecture}}' "$i")"; done
