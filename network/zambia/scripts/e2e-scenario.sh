#!/usr/bin/env bash
# End-to-end procurement scenario on the live ZPPA/OAG network.
# Each step runs as a real enrolled user; every transaction must be endorsed by both organisations.
# Expected rejections are checked too. Results go to docs/phase2/e2e-results.md.
#
# Usage (from network/zambia, via the ~/procurement path): ./scripts/e2e-scenario.sh

set -uo pipefail
cd "$(dirname "$0")/.."
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config
export CORE_PEER_TLS_ENABLED=true

ORGS=${PWD}/organizations
ORDERER_CA=${ORGS}/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem
ZPPA_TLS=${ORGS}/peerOrganizations/zppa.example.com/tlsca/tlsca.zppa.example.com-cert.pem
OAG_TLS=${ORGS}/peerOrganizations/oag.example.com/tlsca/tlsca.oag.example.com-cert.pem
CHANNEL=procurement
CC=procurement
REPORT=${PWD}/../../docs/phase2/e2e-results.md

RUN=$(date +%s)
TENDER="ZPPA/DEMO/${RUN}"
AWARD="AWD-${RUN}"
PASS=0
FAIL=0
ROWS=()

sha() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }
iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }

# as <user> <org>: act as an enrolled user, talking to their own organisation's peer
as() {
  local user=$1 org=$2
  if [ "$org" = zppa ]; then
    export CORE_PEER_LOCALMSPID=ZPPAMSP CORE_PEER_ADDRESS=localhost:7051 CORE_PEER_TLS_ROOTCERT_FILE=$ZPPA_TLS
  else
    export CORE_PEER_LOCALMSPID=OAGMSP CORE_PEER_ADDRESS=localhost:9051 CORE_PEER_TLS_ROOTCERT_FILE=$OAG_TLS
  fi
  export CORE_PEER_MSPCONFIGPATH=${ORGS}/peerOrganizations/${org}.example.com/users/${user}@${org}.example.com/msp
  WHO="${user} ($(echo "$org" | tr a-z A-Z))"
}

# args <fn> <arg>...: build the JSON for a chaincode call
args() {
  local fn=$1; shift
  local json="{\"function\":\"${fn}\",\"Args\":["
  local first=1
  for a in "$@"; do
    [ $first = 1 ] || json+=","
    json+=$(jq -Rn --arg v "$a" '$v')
    first=0
  done
  echo "${json}]}"
}

invoke() {
  peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA" \
    -C $CHANNEL -n $CC --peerAddresses localhost:7051 --tlsRootCertFiles "$ZPPA_TLS" \
    --peerAddresses localhost:9051 --tlsRootCertFiles "$OAG_TLS" --waitForEvent -c "$(args "$@")" 2>&1
}

query() { peer chaincode query -C $CHANNEL -n $CC -c "$(args "$@")" 2>&1; }

record() { # record <PASS|FAIL> <step> <detail>
  [ "$1" = PASS ] && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
  ROWS+=("| $(( PASS + FAIL )) | $2 | ${WHO} | $1 | $3 |")
  printf '%-4s %-62s %s\n' "$1" "$2" "$3"
}

# ok <description> <fn> <args...>: the call must succeed
ok() {
  local desc=$1; shift
  local out; out=$(invoke "$@")
  if grep -q "status:200" <<<"$out" && grep -q "committed with status (VALID)" <<<"$out"; then
    record PASS "$desc" "committed (VALID)"
  else
    record FAIL "$desc" "$(grep -o 'message:"[^"]*"' <<<"$out" | head -1)"
  fi
}

# denied <description> <expected text> <fn> <args...>: the call must be rejected with that reason
denied() {
  local desc=$1 want=$2; shift 2
  local out; out=$(invoke "$@")
  if grep -q "status:200" <<<"$out"; then
    record FAIL "$desc" "was accepted but should have been rejected"
  elif grep -qF "$want" <<<"$out"; then
    record PASS "$desc" "rejected: ${want}"
  else
    record FAIL "$desc" "wrong reason: $(grep -o 'message:"[^"]*"' <<<"$out" | head -1)"
  fi
}

echo "Scenario ${RUN}: tender ${TENDER}"
CLOSING=$(( $(date +%s) + 75 ))

as regulator1 zppa
ok "Regulator sets standstill to 0 h for the demo" AwardContract:SetStandstillHours 0 "$(sha "demo standstill decision")"

as officer1 zppa
ok "Officer publishes tender (K150,000, closes in 75 s)" TenderContract:PublishTender "$TENDER" 15000000 "$(iso $CLOSING)" "[\"$(sha "tender document v1")\"]" 2

as gateway zppa
denied "Gateway cannot publish a tender" 'role \"gateway\"' TenderContract:PublishTender "${TENDER}-X" 100 "$(iso $CLOSING)" "[\"$(sha x)\"]" 2
ok "Supplier alpha submits sealed bid" BidContract:SubmitBid "$TENDER" BID-A SUP-alpha "$(sha "alpha ciphertext")"
ok "Supplier bravo submits sealed bid" BidContract:SubmitBid "$TENDER" BID-B SUP-bravo "$(sha "bravo ciphertext")"
denied "Same supplier cannot bid twice" "already bid" BidContract:SubmitBid "$TENDER" BID-C SUP-alpha "$(sha "alpha again")"

as committee1 zppa
denied "Committee cannot approve opening before closing" "before closing" BidContract:ApproveOpening "$TENDER"

WAIT=$(( CLOSING - $(date +%s) + 3 ))
if [ $WAIT -gt 0 ]; then echo "     waiting ${WAIT} s for the tender to close..."; sleep $WAIT; fi

as gateway zppa
denied "Late bid after closing is rejected" "closed at" BidContract:SubmitBid "$TENDER" BID-LATE SUP-charlie "$(sha "late ciphertext")"

as officer1 zppa
denied "Bid cannot be opened without committee quorum" "needs 2 committee approvals" BidContract:OpenBid "$TENDER" BID-A "$(sha "alpha plaintext")"

as committee1 zppa
ok "Committee member 1 approves opening" BidContract:ApproveOpening "$TENDER"
denied "Same member cannot approve twice" "already approved" BidContract:ApproveOpening "$TENDER"
as committee2 zppa
ok "Committee member 2 approves opening (quorum reached)" BidContract:ApproveOpening "$TENDER"

as officer1 zppa
ok "Officer opens bid A" BidContract:OpenBid "$TENDER" BID-A "$(sha "alpha plaintext")"
ok "Officer opens bid B" BidContract:OpenBid "$TENDER" BID-B "$(sha "bravo plaintext")"
ok "Officer awards tender to bid A (K140,000)" AwardContract:MakeAward "$AWARD" "$TENDER" BID-A 14000000 "$(sha "evaluation report")"
ok "Officer records signed contract" AwardContract:SignContract "$AWARD" "$(sha "signed contract")"
ok "Officer adds milestone 1 (K60,000)" MilestoneContract:AddMilestone "$AWARD" MS-1 6000000 "$(iso $(( RUN + 30*86400 )))"
ok "Officer adds milestone 2 (K80,000)" MilestoneContract:AddMilestone "$AWARD" MS-2 8000000 "$(iso $(( RUN + 60*86400 )))"
denied "Payment before completion is refused" "only after completion" MilestoneContract:RecordPayment "$AWARD" MS-1 "PAY-${RUN}-1" 6000000 IFMIS-DEMO-1
ok "Officer completes milestone 1 with evidence" MilestoneContract:CompleteMilestone "$AWARD" MS-1 "$(sha "delivery note")"
ok "Officer records payment for milestone 1" MilestoneContract:RecordPayment "$AWARD" MS-1 "PAY-${RUN}-1" 6000000 IFMIS-DEMO-1
denied "Duplicate payment is refused" "already been recorded" MilestoneContract:RecordPayment "$AWARD" MS-1 "PAY-${RUN}-1" 6000000 IFMIS-DEMO-1

as risk-service zppa
ok "AI service raises risk alert (score 82)" AlertContract:RaiseAlert "ALT-${RUN}" tender "$TENDER" 82 rf-0.1.0 "$(sha "shap explanation")"

as auditor1 oag
denied "Auditor cannot publish a tender" "organisation OAGMSP" TenderContract:PublishTender "${TENDER}-Y" 100 "$(iso $(( $(date +%s) + 600 )))" "[\"$(sha y)\"]" 2
ok "Auditor (OAG) escalates the alert" AlertContract:ReviewAlert "$TENDER" "ALT-${RUN}" ESCALATED "$(sha "escalation note")"

echo
echo "Ledger state read back by the auditor from the OAG peer:"
TENDER_JSON=$(query TenderContract:ReadTender "$TENDER")
AWARD_JSON=$(query AwardContract:ReadAward "$AWARD")
HISTORY_JSON=$(query TenderContract:GetTenderHistory "$TENDER")
echo "$TENDER_JSON" | jq -c '{id, status, estValue, version, approvals: (.approvals | length), openingApproved}'
echo "$AWARD_JSON" | jq -c '{id, status, supplierRef, amount, contractValue, paidTotal}'
echo "$HISTORY_JSON" | jq -r '.[] | "  \(.timestamp)  v\(.tender.version)  \(.tender.status)  tx \(.txId[0:12])…"'

{
  echo "# Phase 2 end-to-end scenario"
  echo
  echo "Run ${RUN} on $(date '+%d %B %Y %H:%M') · tender \`${TENDER}\` · channel \`${CHANNEL}\` · chaincode \`${CC}\`"
  echo
  echo "Every transaction was endorsed by both peer0.zppa and peer0.oag (majority policy) and waited for commit."
  echo
  echo "**Result: ${PASS} passed, ${FAIL} failed**"
  echo
  echo "| # | Step | Caller | Result | Detail |"
  echo "|---|---|---|---|---|"
  printf '%s\n' "${ROWS[@]}"
  echo
  echo "## Ledger state read back by OAG"
  echo
  echo '```json'
  echo "$TENDER_JSON" | jq .
  echo "$AWARD_JSON" | jq .
  echo '```'
  echo
  echo "## Tender history (every version, oldest first)"
  echo
  echo '```'
  echo "$HISTORY_JSON" | jq -r '.[] | "\(.timestamp)  v\(.tender.version)  \(.tender.status)  approvals=\(.tender.approvals | length)  tx \(.txId)"'
  echo '```'
} > "$REPORT"

echo
echo "Result: ${PASS} passed, ${FAIL} failed · report: docs/phase2/e2e-results.md"
[ $FAIL -eq 0 ]
