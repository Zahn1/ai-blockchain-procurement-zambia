# Prototype demonstration: requirements 3.5.3 and 3.5.4

About 10 minutes. Sample files are in this folder (`docs/demo/`).

## Before the lecturer arrives

1. Check that the blockchain and IPFS are running:
   ```bash
   docker ps --format '{{.Names}}'
   ```
   The list should include `peer0.zppa.example.com`, `peer0.oag.example.com`, `orderer.example.com` and `procurement-ipfs-1`. If Docker is not running, start it with `colima start` and wait a minute.
2. Start the prototype:
   ```bash
   ~/procurement/backend/start.sh
   ```
3. Open **http://localhost:3000** in a browser.

## 1. Requirement 3.5.3: Tender Publication

> *"When a tender is published, the system must compute a hash of the tender document and record it on the blockchain ledger with a timestamp, so that the published version cannot later be changed without detection."*

1. **Publish tender** tab. Keep the reference and title, set **Closes in** to **3** minutes, choose `tender-document.txt`, then click **Publish to ledger**.
2. Point out the result:
   - the **SHA-256 hash** of the document
   - the **IPFS CID**, where the document is stored
   - the **transaction ID** and **block number**, which show it is on the blockchain
3. Say: *"The transaction was endorsed by two organisations, ZPPA and the Office of the Auditor General. Neither can change it alone."*
4. **Verify and ledger** tab. Under **Check a document against the ledger**, choose the tender and upload `tender-document.txt`. The result is a green **Match**.
5. Upload `tender-document-altered.txt`. The result is a red **No match**. Say: *"Someone changed the delivery period from 30 to 60 days. The hash no longer matches the ledger, so the change is detected."*

## 2. Requirement 3.5.4: Encrypted Bid Submission

> *"The system must encrypt every submitted bid, store the encrypted file off-chain and record its hash and submission time on the ledger before the closing time. Each bidder must receive a signed receipt containing the bid hash. Submissions after the closing time must be rejected."*

1. **Submit sealed bid** tab. Choose the tender (the countdown shows the time left), supplier **SUP-alpha**, and file `bid-alpha.txt`. Click **Encrypt and submit**.
2. Point out the **signed receipt**: the ciphertext hash, the ledger submission time, the transaction ID and the digital signature.
3. Click **View stored file on IPFS**. Say: *"This is what is actually stored. Without the key nobody can read the price, not even the IPFS operator."*
4. Submit a second bid as **SUP-bravo** with `bid-bravo.txt`.
5. Optional: try **SUP-alpha** again. It is rejected because each supplier can bid only once.
6. Click **Copy receipt to checker**, then **Check signature**: **Valid**. Change one character in the receipt (e.g. the block number) and check again: **Invalid**.
7. **Wait until the countdown says Closed.** Then submit `bid-late.txt` as **SUP-charlie**. It is **Rejected by the ledger**: *"bidding for tender … closed at …"*. Say: *"The website did not block this. The smart contract on both peers did, using the transaction timestamp, so going around the website would not help."*
8. **Verify and ledger** tab, then **Load from ledger**. Show:
   - the tender record and its history
   - the two sealed bids, recorded only as ciphertext hashes
   - no late bid

## If something goes wrong

| Problem | Fix |
|---|---|
| Page does not load | Start the prototype (step 2 above) |
| "Something went wrong on the server" | Check the terminal running `start.sh`; usually Docker or IPFS is not running |
| Error mentioning `UNAVAILABLE` or `14` | The Fabric network is down: `cd ~/procurement/network/zambia && ./network.sh up -ca`, then redeploy the chaincode (see `docs/phase2`) |

## Evidence for Chapter 4

- Route tests: `docs/phase2/backend-tests.txt`
- Live end-to-end scenario on the network (25 of 25 passed): `docs/phase2/e2e-results.md`
- Screenshots: take one at each numbered step above
