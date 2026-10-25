# Shamir key splitting for bid opening (FR-BID-07, stretch goal)

Off by default. Turn it on with `SHAMIR_OPENING=on` in `backend/.env` (or the environment) and restart the back end.
Each tender keeps the mode it had when its committee was appointed, so switching the setting never affects tenders
already under way.

## The problem it solves

Without it, every bid's AES-256 key is wrapped with one master key held by the back end. The ledger stops bids being
*officially* opened early (closing time and committee quorum), but whoever runs the server could in principle unwrap a
key and read a bid. With key splitting, nobody can open the bids alone, including the server's operator: it takes the
committee's quorum.

## How it works

| When | What happens |
|---|---|
| Committee appointed | The back end creates an X25519 key pair for the tender. Bid keys already received are re-wrapped with its public key (ECIES: ephemeral X25519, HKDF-SHA256, AES-256-GCM) and the master-wrapped copies are deleted. The private key is split with Shamir's secret sharing into one share per member, any *quorum* of which rebuild it (the same quorum as the ledger's opening approvals). The private key is then erased. |
| Bid submitted afterwards | Its key is wrapped with the tender's public key; the back end keeps no usable copy. |
| Member collects their share | Shown once (copy or save as a file); the back end deletes its sealed copy. The share's SHA-256 hash is kept to recognise it later. |
| Opening | Each member approves on the ledger (as before) **and** hands back their share, checked against its hash. With the quorum's shares the back end rebuilds the private key in memory, checks it against the tender's public key, unwraps the bid keys and opens the bids. The shares and the rebuilt key are then discarded. Opened bids' keys are kept so the committee can read them. |

Splitting uses `shamir-secret-sharing` 0.0.4 (Privy; zero dependencies; independently audited) rather than code written
for this project. Combining fewer shares than the threshold does not fail by itself, it silently gives a different key,
so every rebuilt key is checked against the tender's public key before use.

## Tests

- Unit (`backend/test/shamir.test.js`, 6): wrapping and unwrapping; tampering detected; any quorum rebuilds, fewer do
  not (including 2 of a 3-quorum); another tender's shares do not; share format.
- API (`backend/test/evaluation.test.js`, 8): the split removes the back end's copies; later bids are wrapped too; a
  share is issued once; the committee is then fixed; ledger approvals alone do not open; a share must be the member's own
  and come after their approval; with the quorum's shares the bids open and the shares are dropped; with the setting off
  nothing changes.
- Front end (`evaluation-contracts.test.jsx`, 3): collecting the share once with a warning; waiting for shares; handing
  a share back.
- Live on the network: `shamir-live.md`, 16 of 16 checks.

## Limits

- **Before the committee is appointed**, bid keys are protected by the back end's master key as before; they are
  re-wrapped at appointment. Appoint the committee when publishing the tender to remove that window.
- **The committee cannot change** once the key is split (a new split would need the old private key, which no longer
  exists).
- **A lost share** is gone for good. If more members lose their shares than the quorum allows, the bids cannot be
  opened; a production system would add an escrow share held by a separate authority (e.g. the Auditor General).
- **The back end still sees the rebuilt key** for the moment of opening, as it must to decrypt. Avoiding even that would
  mean decrypting in each member's browser, which is beyond the prototype.
- Shares and their hashes are kept off-chain; recording each share's hash on the ledger would be a small chaincode change.
