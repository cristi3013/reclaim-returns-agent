# Reclaim · end-to-end test scenarios

Two layers:

1. **Automated**: `npm test`. That covers the acceptance tests against `expected-results.json` plus the stress suite `apps/api/test/stress.test.ts`, which runs in-process with mock SAP and rules only. No model, no Supabase, no mailbox, no DS4.
2. **Manual**: the checklist below, run in the browser before the presentation. Run it on SAP **mock** mode unless a row says otherwise. Never approve demo invoices 90000353–90000359 in real mode; the backend refuses them, and that refusal is itself a test (G1).

Start: `npm run dev --workspace apps/api` (backend on :3000, needs `apps/api/.env`) and `npm run dev` (web on :5173, `VITE_API_MODE=http` for the real backend). Demo accounts: `cs.lead@`, `credit.manager@`, `finance.director@`, `returns.desk@reclaim.demo`.

## Stress suite (automated)

`npx vitest run test/stress.test.ts` from `apps/api`. `STRESS_N=1000` raises the load (default 240 complaints).

| # | Scenario | Must hold |
|---|---|---|
| S1 | N emails posted to `/api/inbound` at once, then 50 resent with the same message id | N cases, all 201; every resend 200 `duplicate: true`; still N cases |
| S2 | Every case run at once | No case stuck in `received`/`investigating`; quantity ≤ invoiced, amount ≤ invoice total, approver = `approverFor(amount, rule)`; every SAP-related event has an L4 step; no SAP document without an approval |
| S3 | Every waiting proposal approved at once | No 5xx; at most one SAP document per document type and invoice (R8 holds under load) |
| S4 | One proposal approved 25× at once, then its document released 10× at once | Exactly one 200 and one document; exactly one release and one `sap_release` event |
| S5 | Role matrix: every role below the required approver tries to approve | 403 every time, nothing written; the required role gets 200; a bad token gets 401 |
| S6 | Gateway fails 30% of reads (seeded, repeatable) | No crash, no unexpected 5xx, no case stuck in `investigating`, no document; `/health` still 200 |
| S7 | Analytics and case list with every case loaded | Under 2 s and 1 s |

Reference run on a laptop with 240 complaints: intake about 10 ms, running everything about 20 ms, analytics about 1 ms.

**Bug found by S4 and fixed:** releasing the same document from two clicks or two tabs released it twice. The check and the SAP call were separated by an await. `release()` now holds the case the same way `approve()` does (`apps/api/src/service.ts`).

## Manual checklist

Tick each row in the browser. "Expect" is what a correct run shows.

### A. The seven demo emails (Inbox → open case → Run)

| # | Email | Expect |
|---|---|---|
| A1 | 01 damaged / leaking, 90000353 | Two options: A = R1 return YRE, B = R3 credit YCR. B is recommended because the email says leaking. Approver: credit manager |
| A2 | 02 price, 90000354 | R4. No document unless the price really differs; if it does, YCR for the difference. Credit manager |
| A3 | 03 short delivery, 90000355 | R5, YCR for the missing quantity, credit manager |
| A4 | 04 over quantity, 90000356 | R7, no document, case asks the customer (`needs customer input`) |
| A5 | 05 no invoice | Invoice not found, no document, reply asks for the invoice number (expected R9; ours labels it NONE, same outcome) |
| A6 | 06 duplicate, 90000353 after A1 was approved | R8, no document, the reply quotes the existing document number |
| A7 | 07 replacement, 90000358 | R6, handed over to customer service, no document |
| A8 | Evaluation page → Run evaluation | All seven pass |

### B. Choice and approval

| # | Step | Expect |
|---|---|---|
| B1 | A1: choose option A, then approve | YRE written with billing block 08; audit shows "Option A chosen" |
| B2 | A1 on a fresh reset: approve the recommended option B | YCR written with billing block 08 |
| B3 | Edit the quantity down before approving | Amount recalculated; approver role recalculated; edited quantity shown in the audit and the report |
| B4 | Edit the quantity above the invoiced quantity | Capped at the invoiced quantity |
| B5 | Reject with a comment | No SAP write; the case shows rejected; the reject is in the audit trail |
| B6 | Click Approve twice quickly / approve in two tabs | One document; the second click gets "not awaiting approval" |

### C. Roles (sign in as each demo account)

| # | Account | Expect |
|---|---|---|
| C1 | CS lead on a credit ≤ 500 EUR | Can approve |
| C2 | CS lead on a credit > 500 EUR, or any R3/R4/R5 | Approve refused (403 message) |
| C3 | Credit manager on 500–5,000 EUR | Can approve and release |
| C4 | Credit manager on > 5,000 EUR | Refused; the finance director can |
| C5 | Returns desk | Cannot approve; can confirm goods receipt on a YRE |
| C6 | Signed out / expired token | Login page; API returns 401 |
| C7 | Reject as a role below the approver | **Known gap:** reject has no role check today. Note the result |

### D. Release and goods receipt

| # | Step | Expect |
|---|---|---|
| D1 | Release a YCR as the approver role | Billing block removed, `sap_release` event with L4 5.2.1 |
| D2 | Release a YRE before goods receipt | 409: goods must be received first (5.1.3) |
| D3 | Returns desk confirms goods receipt, then the approver releases | Released; the event says "confirmed by the Returns desk" |
| D4 | Release again, or double-click Release | 409 "already released" / "being released"; one release only |
| D5 | Release as a lower role | 403 |

### E. Guards

| # | Step | Expect |
|---|---|---|
| E1 | Settings → simulate conflict on, approve | SAP refuses with 412; case shows `sap_write_failed`; nothing written |
| E2 | Run a case that is already decided | 409 |
| E3 | Same email posted twice to `/api/inbound` (same Message-ID) | Second returns `duplicate: true`, no new case |
| G1 | Real SAP mode, approve a demo invoice (90000353–59) | 400 "hackathon demo data, never written to the real DS4". **Do not bypass** |
| E4 | Gateway down (current state: 404) in real mode | Readable error on the case, no crash, nothing written |

### F. Reports and audit

| # | Step | Expect |
|---|---|---|
| F1 | Reports → Excel | Five sheets, filters on, money and dates formatted |
| F2 | Reports → PDF | Landscape, readable columns, page numbers |
| F3 | Reports → XML | Opens in a browser as well-formed XML |
| F4 | Pick a period with no cases | Zero counts; files still download |
| F5 | Case page → Audit pack | Portrait PDF: complaint, decision, approvals, SAP documents, audit trail |
| F6 | Numbers match | Excel, PDF and XML show the same totals as Analytics for the same period |

### G. Devices and resilience

| # | Step | Expect |
|---|---|---|
| G2 | Phone width (or installed PWA): inbox → approvals → case → approve | Works; Reports is not in the bottom tabs |
| G3 | Stop the backend mid-session | Error state with Retry; recovers when the backend is back |
| G4 | Demo reset | All cases back to the seed state |

### H. Manual load (optional, against a running backend in mock mode)

On a **local** backend only, never the team's shared deployment:

```bash
for i in $(seq 1 200); do curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/inbound \
  -H 'content-type: application/json' \
  -d "{\"from\":\"load@test.example\",\"subject\":\"Load $i\",\"text\":\"Invoice 90000355, 2 drums short\",\"messageId\":\"<load-$i@test>\"}" & done | sort | uniq -c
```

Expect: 201 two hundred times. The inbox stays responsive, and the cases resolve as R5 or R8 duplicates. Then run `/api/demo/reset`.
