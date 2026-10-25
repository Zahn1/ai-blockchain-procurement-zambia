# Phase 6 dependency audit

25 October 2026. Every third-party package was checked against the public vulnerability databases with each ecosystem's
standard tool: `npm audit` (Node), `pip-audit` 2.9.0 (Python, PyPA) and `govulncheck` 1.1.4 (Go, the Go team).
Fixes were applied where they exist; new versions were taken only once they had been public for at least two weeks
(a guard against freshly published, compromised releases). After each upgrade the full test suite was re-run.

## Results

| Component | Before | After | What changed | Tests after |
|---|---|---|---|---|
| Back end (Node) | 16 (13 high, 3 moderate) | **0** | `npm audit fix` (body-parser via Express, nodemailer); puppeteer-core 23 → 25.13.0 (screenshot tool); uuid 11.1.1 for exceljs and deepmerge-ts 8.0.2 for the Prisma CLI, pinned with `overrides` | 189 pass; Prisma validate, migrate status and generate checked |
| Front end (Node) | 10 (3 critical, 4 high, 3 moderate) | **0** | `npm audit fix`; Vite 6.0 → 6.4.4; Vitest 2 → 4.1.12; React Router 6 → 7.18.4 | 62 pass; build checked |
| AI service (Python) | 8 (Starlette ×7, pytest ×1) | **0** | FastAPI 0.115 → 0.143.0 with Starlette 1.3.1; pytest 9.0.3 | 25 pass |
| Chaincode (Go) | 6 (x/net ×5, standard library ×1) | 1, not applicable | golang.org/x/net 0.58 → 0.60.0 (HTTP/2) | 47 pass |
| Benchmark (Caliper, dev tool) | 15 | 14, accepted | `npm audit fix` (gRPC, ws) | benchmark not re-run |

## Which findings mattered

| Finding | Runs in the deployed system? | Assessment |
|---|---|---|
| body-parser (via Express), nodemailer | Yes, back end | Fixed |
| React Router open redirect | Yes, browser | Fixed. It needed attacker-controlled link targets, which the app does not build, but the upgrade was cheap |
| Starlette (FastAPI) | Yes, AI service | Fixed. Exposure was low: the service listens on 127.0.0.1 and only the back end calls it |
| uuid via exceljs | Yes, spreadsheet reports | Fixed by override. exceljs only calls `v4()` without a buffer, so it was not affected |
| Vite dev server, Vitest | Development, and the demo runs on the Vite dev server | Fixed. The Vite issue let a malicious website read from a running dev server |
| puppeteer-core, Prisma CLI (deepmerge-ts) | No, local tools | Fixed |
| golang.org/x/net HTTP/2 | Yes, chaincode's gRPC link to its own peer | Fixed in the code. Exploiting it needed control of the peer. **The running chaincode (1.3) still has the old version until the next chaincode upgrade**, planned after the 22 November demonstration to keep the demo network unchanged |
| Go `crypto/x509` (GO-2026-6809): distrust of compromised public intermediate certificates | The chaincode is built in Fabric's image with Go 1.26.4 | Not applicable: Fabric identities and TLS use the network's own private certificate authorities, not the public web PKI. Fixed in Go 1.26.10 / 1.27.3 for the next rebuild |
| Caliper's dependencies (express, tar-fs, dockerode …) | No: a benchmark run only on the laptop against the project's own network | Accepted. The only fix offered is downgrading Caliper to a 2020 release |

Remaining notice: pytest prints a deprecation warning from Starlette's test client (it prefers `httpx2`). It affects
only the tests and has no security impact.
