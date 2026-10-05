# Reclaim backend · context for whoever (or whatever) works on it next

Read this first. It is the same context the frontend was built with, condensed. The frontend is done and merged; the backend skeleton in this folder runs the full flow on the mock gateway and passes the acceptance test. Your job is to harden it, wire the real gateway and the model, and deploy it.

## 1. What the product does, in one paragraph

A customer of a chemicals distributor emails a complaint ("two drums leaked, invoice 90000353"). Reclaim reads the email, finds the invoice and its history in SAP, applies the written returns policy (nine rules, R1 to R9), and proposes either a **customer return (YRE)**, a **credit memo request (YCR)**, or no document, with the right reason code and billing block 08. A named person approves in the UI. Only then does the backend write to SAP, with the record's version stamp (ETag) so a conflicting change is refused (412), never overwritten.

**The model reads and explains. Code decides about money. A person approves every SAP change.** That sentence is the product. Everything below protects it.

## 2. Where things are

```
packages/shared/src/
  enums.ts        statuses, complaint types, rule ids, roles, L4 steps
  policy.ts       RULES R1..R9 (text + document + reason), thresholds, approverFor(), capQuantity(), L4_STEPS
  schemas.ts      Zod: Facts, Findings, Decision, Proposal, Case, SapDocument, CaseEvent, Settings, AnalyticsSummary ...
  rules.ts        decide(facts, findings, ctx) → one or two Decisions   ← the policy as code. Pure. Tested.
  sap-payload.ts  buildSapPayload(decision, invoice, ref) → exact OData body for YRE / YCR
  narrative.ts    narrate(...) → explanation, customer reply, approver briefing (templates, used in rules-only mode and as fallback)
  rules-only.ts   regexFacts(case) → Facts without a model
  routes.ts       API_ROUTES: every route the frontend calls
  fixtures/       the 8 demo cases, captured invoices, expected results (the oracle), analytics history

apps/api/src/
  app.ts          Fastify routes = API_ROUTES, SSE on /api/events, error → {message,status}
  server.ts       listen; env → settings
  service.ts      the application: seed, ingest, run, choose, approve (the ONLY SAP write), reject, release, eval, analytics
  pipeline.ts     one case: extract → investigate → decide → explain → propose. Never writes to SAP.
  store.ts        in-memory Map<id, Case> + settings. Swap for Supabase here.
  events.ts       ev() audit events with L4 step ids; EventHub for SSE
  gateway/        Gateway interface; MockGateway (captured DS4 data); RealGateway (Alex's CAP service on BTP)
  ai/             Ai interface; RulesOnlyAi (no model); ClaudeAi (extract facts from email, photos and PDFs, narrate)
apps/api/test/acceptance.test.ts   the 8 demo cases over HTTP must match expected-results.json
apps/web/src/api/mock/              the frontend's in-browser mock of this backend: same behaviour, useful as a second reference
docs/Returns-Agent-Architecture.md  the full architecture (functional + technical)
docs/demo-script.md                 the 8-minute stage demo
mock-data/                          organizers' emails, SAP responses, policy, expected-results.json
```

## 3. Run and test

```bash
npm install                                 # at the repo root (npm workspaces)
cp apps/api/.env.example apps/api/.env      # fill ANTHROPIC_API_KEY to enable the model
npm run dev --workspace apps/api            # http://localhost:3000, mock gateway, SSE on /api/events
NODE_ENV=test npm test --workspace apps/api # acceptance test, no key needed
```

Point the frontend at it: in `apps/web/.env` set `VITE_API_MODE=http` and `VITE_API_BASE=http://localhost:3000`, then `npm run dev --workspace apps/web`.

Environment variables (`apps/api/.env`):

| Variable | Values | Effect |
|---|---|---|
| `PORT` | 3000 | listen port (Cloud Foundry sets it) |
| `SAP_MODE` | `mock` / `real` | start value of the SAP switch; `real` uses `GATEWAY_URL` |
| `GATEWAY_URL` | https://o2c-returns-agent.cfapps.ap21.hana.ondemand.com/odata/v4/returns | Alex's CAP service |
| `AI_MODE` | `assisted` / `rules_only` | start value of the AI switch |
| `ANTHROPIC_API_KEY` | sk-ant-… | without it the backend silently runs rules-only even in assisted mode |
| `CLAUDE_MODEL` | `claude-opus-5-5` (default) | model for both calls |

Both switches can be changed at runtime from the UI top bar (`PUT /api/settings`).

## 4. The flow of one case (what `pipeline.ts` does)

1. **Intake.** Case created from an `.eml` (seed or upload). Status `received`.
2. **Extract** (`ai.extractFacts`). Email text + attachments → `Facts`. Photos (PNG, JPEG, WebP, GIF) go to the model as image blocks, PDFs (e.g. a signed delivery note) as document blocks; other files are kept with the case but not sent, and so are files over 20 MB (`MODEL_READABLE_TYPES` in `src/ai/types.ts`). The type recorded at intake wins over the file extension. Verified live on Bedrock: from an email saying only "not everything arrived", the model read invoice, material and the missing 2 KG from the delivery-note PDF. Fields: invoice number or null, material, claimed quantity, complaint type, claimed price, wants replacement, goods returnable, evidence, language. ClaudeAi uses structured output with the shared `FactsSchema`; RulesOnlyAi uses regex. Event kind `model` or `rule`, L4 `5.1.1`.
3. **Investigate** (gateway reads, each one an audit event, L4 `5.1.1`):
   `getInvoice` (or `findInvoices` when no number and a material is known) → `checkExistingCredits` → `getAgreedPrice` (price complaints only) → `plantCompanyCode` (reference table, for intercompany).
4. **Decide** (`decide()` from shared, no model). One decision, or two for damaged goods (R1 return vs R3 credit-only, with a recommendation). Quantity capped at invoiced, amount = qty × invoice unit price (or the price difference for R4), approver from the threshold table, intercompany flag if plant company ≠ invoicing company. L4 `5.1.1`, `5.2.1`, `5.2.2`.
5. **Explain** (`ai.narrate`). Explanation citing the rule, customer reply draft, three-line approver briefing. The model may not change a number; the UI renders numbers from the decision object only.
6. **Status** by rule: R6 → `handed_over`, R7/R9 → `needs_customer_input`, R8 → `duplicate`, everything else → `awaiting_approval`.

Re-running a case that already has a SAP document is refused (409). Re-running keeps the approval, SAP and error events in the audit trail.

## 5. Approval and the SAP write (`service.approve`)

- Only in status `awaiting_approval`; concurrent approves are serialized, the second gets 409.
- An edited quantity is capped at the invoiced quantity, the amount is recomputed, and the **approver role is re-derived** from the threshold table. A role below the required one gets 403.
- In SAP mode `real`, the hackathon demo invoices (90000353–90000359, `DEMO_INVOICES`) are refused with 400. They must never be written to DS4.
- Document type NONE (price not supported, policy gap): approving sends the reply and closes the case. No SAP call.
- **Read again right before the write.** After the checks and before anything is saved, `checkExistingCredits(invoice)` is called once more. The investigation may be hours old; if a return or credit request for the invoice exists now, the approval is refused with 409 naming the documents, the case stays `awaiting_approval`, the findings are updated with what was found, and an `error` event (L4 `5.1.1`) records it. If the lookup itself fails, the approval is refused with that status and nothing is written.
- Before the create, the gateway's own approval record is opened and closed: `logRequest({invoiceNumber, proposedAction, rule, reason, claimedQuantity, claimedAmount, creditValue, evidenceUrl})` → `setApprovalStatus({ID, status: APPROVED, approvedBy, approverRole})`, with an `approval` event carrying the record ID. If either call fails the case goes to `sap_write_failed` and nothing has been written to SAP. The record ID and the version stamp from the create response are stored on the `SapDocument` (`gatewayLogId`, `etag`).
- YRE → `gateway.createReturn(payload, ctx)`, YCR → `gateway.createCreditMemoRequest(payload, ctx)`. The payload is `proposal.sapPayload`, built by `buildSapPayload`; `ctx` is `{rule, gatewayLogId, creditValue, evidenceUrl}` (the gateway derives the SAP order reason from the rule). Success → `SapDocument` stored, status `written_to_sap`, event `sap_write` with L4 `5.1.2` or `5.2.1`. Failure → status `sap_write_failed`, event `error` with the HTTP status and SAP's message; the route returns that status (412 on conflict).
- `GET /api/sap/:id/status` → `returnStatus(documentId)`: for a YRE, the warehouse receipt as SAP reports it through `getReturnStatus` (`{status, received, source: 'sap'}`); `source: 'none'` when the gateway has no such function or it failed. The UI polls it every 15 s while the release button is visible.
- `release(documentId, {actor, role, goodsReceived?})` → `gateway.release({type, number, etag})`. Removing billing block 08 is the credit decision itself, so: same role as the approval (403 otherwise), only once (409 on repeat), refused if the create response did not confirm block 08. For a return (YRE), step 5.1.3: SAP is asked first; if it reports the goods received the release goes ahead with `goodsReceipt: 'confirmed by SAP'`; otherwise `goodsReceived: true` from the person stands in, recorded as `'confirmed manually'` in the `sap_release` event; without either the release is a 409. `etag` is the document's version stamp from the create response, sent back as `versionStamp`; a change in SAP since then is a 412. YCRs are released with `releaseCreditMemoRequest` (only after APPROVED), YREs with `releaseCustomerReturn`.
- Approve order of operations: the edited decision is computed in local variables first, every check runs (quantity > 0, role vs the re-derived approver, SAP-mode match, demo-invoice guard, the duplicate re-check), and only then is the proposal changed and the write attempted. A refused approval changes nothing.
- A proposal is stamped with the SAP mode it was investigated in. Approving it in another mode is a 409: re-run the case first. Switching to real mode without `GATEWAY_URL` is refused.
- After a successful create the response's `HeaderBillingBlockReason` is checked. If it is present and not `08`, the document is recorded, an error event says it was created without the block, and release is refused.

## 6. The gateway contract (Alex's CAP service on BTP)

The gateway is the only thing that talks to SAP DS4 (through Destination + Cloud Connector). Every function returns `{ "value": "<JSON string>" }`; `RealGateway.unwrap()` parses it.

Base path `/odata/v4/returns`. Reads are OData v4 functions (GET, parameters in the URL, single quotes doubled); writes are actions (POST, JSON body). Reads time out after 15 s, writes after 30 s; a write timeout is reported as 504 "outcome unknown, check SAP before retrying".

| Our method | His call | Notes |
|---|---|---|
| getInvoice | GET `getInvoice(invoiceNumber)` | raw OData v2 billing document; we map it in `toSnapshot`, keep `__metadata.etag` |
| checkExistingCredits | GET `checkExistingCredits(invoiceNumber)` | `{existingReturns:[], existingCredits:[]}` |
| findInvoices | GET `findInvoices(soldToParty, material, fromDate, toDate)` | dates `YYYY-MM-DD`. Each hit (by `BillingDocument`/`invoiceNumber`) is re-read with `getInvoice`, at most 5. Case 05 |
| getAgreedPrice | GET `getAgreedPrice(soldToParty, material, salesOrganization, distributionChannel)` | PR00 valid today. We read `unitPrice`, `price` or `ConditionRateValue`, divided by `ConditionQuantity` if present. Case 02 |
| getReturnStatus | GET `getReturnStatus(returnDocumentNumber)` | `{returnDocumentNumber, overallProcessingStatus, warehouseReceiptStatus, received}`; step 5.1.3 before releasing a return |
| logRequest | POST `logRequest {invoiceNumber, proposedAction, rule, reason, claimedQuantity, claimedAmount, creditValue, evidenceUrl}` | `RETURN`/`CREDIT`/`REPLACEMENT`/`REJECT`/`PENDING`; returns the `AuditLog` record with `ID`, approvalStatus PENDING |
| setApprovalStatus | POST `setApprovalStatus {ID, status, approvedBy, approverRole}` | `APPROVED`/`REJECTED`; roles spelled with hyphens (`credit-manager`), checked against the credit value |
| createReturn | POST `createReturn {auditLogID, invoiceNumber, invoiceItem, material, quantity, unit, rule, soldToParty, creditValue}` | the gateway maps `rule` to the order reason; must create with reference to the invoice item or SAP makes a normal sale (TAN instead of REN) |
| createCreditMemoRequest | POST `createCreditMemoRequest {auditLogID, invoiceNumber, invoiceItem, material, quantity, unit, rule, soldToParty, creditValue, evidenceUrl}` | returns the YCR with block 08; we read the version stamp from `__metadata.etag` (or `versionStamp`/`etag`) |
| release (YCR) | POST `releaseCreditMemoRequest {creditMemoNumber, versionStamp}` | only after APPROVED. Returns `{creditMemoNumber, status}` |
| release (YRE) | POST `releaseCustomerReturn {returnDocumentNumber, versionStamp}` | returns `{returnDocumentNumber, status}` |
| (not used) | GET `proposeAction(...)`, GET `checkPrice(...)`, POST `confirmSpecialAgreement {ID}` | the gateway's own rule engine and R4 agreement flag; our decisions come from `decide()` in shared, so these are not called |
| getPlantCompanyCode | none | our own table `{ YGLG: 'YDE1', YRO1: 'YRO1' }` in `gateway/real.ts` |

**Reasons.** Since 5 Oct 2026 evening the gateway takes the policy rule id, not a reason, and maps it itself: R1→YRE 102, R2→YRE 101, R3→YCR 104, R4→YCR 101, R5→YCR 103 (its table, confirmed by Alex). `GATEWAY_RULES` in `gateway/real.ts` holds the same table; a write whose rule, document type or reason code disagrees with it is refused with 400 before any call, so a wrong reason never reaches SAP. The create also needs the `auditLogID` from `logRequest`, which ties the SAP document to the approval record his release checks.

**Still to confirm with Alex:** that the create response includes `__metadata.etag` and `HeaderBillingBlockReason`; the customer reference (`PurchaseOrderByCustomer = COMPLAINT-<invoice>`) on the creates, which he is deploying.

Reads are safe to call any time. **Writes only against the team's own invoices on DS4**, `TEAM_INVOICES` in shared: 90000373–90000387 (HACK-T08, customer 10021, material 54, 270 EUR/KG, one line each, billed 29 Sep 2026). The shared demo invoices are guarded in the service and again in `RealGateway`. The "New complaint" dialog in the UI starts from ready-made complaints against 90000377 (R5 credit request), 90000378 (R1 return) and 90000379 (R2 return).

**First real write, what to look at.** After the create, the `sap_write` event records `customerReference` (the `PurchaseOrderByCustomer` the response carries, expected `COMPLAINT-<invoice>`) and `versionStamp`. If the response carries no stamp, an error event says the document cannot be released from here; the gateway's result types (`CreditMemoResult`, `CreateReturnResult`) list neither field, so whether they come through depends on how the gateway serialises its answer. That is the first thing to check on the first write.

**Live findings, 5 Oct 2026 evening (reads against the deployed gateway):**
- `getInvoice`: raw OData v2 document with `to_Item.results` and `__metadata.etag`; our `toSnapshot` maps it. Real 90000358 is 30 KG (the fixture now says so too); real 90000359 ships from plant YGLG, so case 08 is intercompany only on the mock.
- `checkExistingCredits`: `{existingReturns: [], existingCredits: []}` as expected.
- `findInvoices`: `{…, invoices: [full documents]}`. For customer 10021 and material 54 it returns **all 102 hackathon invoices (~1 MB)**, five of them multi-line, ten with 15 KG. The pipeline ranks them with `rankCandidates` (quantity match, then last 14 days, then lowest number) and keeps five; 90000357 comes out first, which is the oracle's answer.
- `getAgreedPrice`: `{…, today, agreedPrices: []}` — **empty for every customer tried** (10021, 10044). The hackathon PR00 (270 EUR/KG) is on the material level, the gateway seems to read a customer-specific table. Until Alex changes it, case 02 ends as "no agreed price, a person decides" in real mode (correct behaviour, but not the oracle's answer). Field names inside `agreedPrices[]` are still unknown; `RealGateway` tries `unitPrice`, `price`, `ConditionRateValue`, `ConditionRateAmount`, `amount`, `rate`, divided by `ConditionQuantity`.
- `getReturnStatus`: `{returnDocumentNumber, overallProcessingStatus, warehouseReceiptStatus, received}`. Used by `service.returnStatus` and the release of a return.

**Open with Alex (in this order):** `getAgreedPrice` reading the material-level PR00 and the field names it returns; the customer reference on the creates (deploying); whether the create response carries `__metadata.etag` and `HeaderBillingBlockReason`.

Lookups that may be missing on the gateway (`findInvoices`, `getAgreedPrice`, the plant table) are **optional**: a failure is recorded as an error event and the rules decide with what is known. A price complaint without an agreed price goes to the credit manager as "no automatic decision". `getInvoice` failing aborts the run.

The creates take flat parameters, so `RealGateway` maps `sapPayload` onto his parameters, so "sent unchanged" holds up to the gateway, and billing block 08 depends on his service. The response check above is the safety net.

SAP facts that bite (from the hackathon guide): writes need a CSRF token fetched with a GET first plus the session cookies (the gateway handles it); a return item needs both `ReferenceSDDocument` and `ReferenceSDDocumentItem`; a released credit memo request is not posted to accounting automatically on DS4 (stop the demo at the release); OData v2 dates are `/Date(ms)/` and numbers are strings.

## 7. The model (ClaudeAi)

**When Bedrock is busy.** `ResilientAi` wraps `ClaudeAi`: 429/5xx answers are retried (3 attempts, 1.5 s then 4 s), and if the model still fails the `RulesOnlyAi` reader takes over for that call, so the case gets its proposal. The pipeline writes an `error` event saying so ("Model unavailable; facts read by pattern rules instead"). The decision never depended on the model; what degrades is the reading of the email and the wording.

**Provider.** `ANTHROPIC_API_KEY` → Anthropic API (model `claude-opus-5-5`). Otherwise `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` → Amazon Bedrock in `AWS_REGION` (default `eu-central-1`) with the EU cross-region inference profile `eu.anthropic.claude-opus-5-5`, so inference stays in Europe. Verified on 5 Oct 2026: the account can call Opus 5.5, Sonnet 5.5, Sonnet 4.6, Sonnet 4.5 and Haiku 4.5 through `eu.` and `global.` profiles.

**Structured output on Bedrock.** The 4.x models accept `output_config.format` (native structured output); the 5.x models reject it and `strict` tools ("Extra inputs are not permitted"). `ClaudeAi.structured()` tries the native way first and falls back to a JSON-only instruction with the JSON schema, validated with the same Zod schema. Both paths were verified with text and with the photo. `CLAUDE_MODEL=eu.anthropic.claude-sonnet-4-6` gives native structured output if ever needed.

**Secrets.** Keys live only in `apps/api/.env` (git-ignored) or in Cloud Foundry environment variables. Never in the repo.

Two calls, both with `client.messages.parse` and `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`, model `claude-opus-5-5`:

- **extractFacts**: system prompt describes each field; the email (photos as image blocks, PDFs as document blocks) is the user message; output format is the shared `FactsSchema`. Effort `medium`. A refusal or unparsable output throws 502 and the run fails cleanly (status back to `received`, error event).
- **narrate**: gets the rule text, the SAP facts, the extracted facts and the decision; returns explanation, reply, briefing. Effort `low`, system prompt cached. On refusal it falls back to the template narrative.

The acceptance test runs rules-only by default. With `ANTHROPIC_API_KEY` set and `AI_MODE=assisted`, it runs with the model and the decisions must still match: that is the proof that the model never decides.

Ideas that fit later, in order of value: a chat endpoint over one case (read-only tools over cases/events), language detection and replies in the customer's language (the facts already carry `language`), anomaly hints from case history (partly done), policy-gap detection (done: rule NONE → `awaiting_approval` for the customer service lead), policy retrieval with embeddings (Supabase pgvector) to ground the explanation on a larger corpus.

## 7b. Who is calling (Supabase Auth)

Every `/api/*` request carries a Supabase session token (`Authorization: Bearer <access token>`; the live stream `/api/events` takes it as `?token=`). `auth.ts` verifies it against the project's public signing keys (JWKS, ES256, issuer `${SUPABASE_URL}/auth/v1`, audience `authenticated`) and builds the **principal**: id, email, name (`user_metadata.name`) and **role from `app_metadata.role`**, which only the service key can set. Routes that decide something (approve, reject, release, goods receipt, status change, reply, reset) take actor and role from the principal and ignore them in the body. Without a valid token the API answers 401 with a sentence a person can act on. Public: `/health`, `/api/status` (the Control Tower polls it) and `/api/inbound` (a webhook, no user behind it).

`SUPABASE_URL` is therefore required. Tests pass `verifier: headerVerifier()` to `buildApp`, whose tokens are `<role>:<name>`; `auth.test.ts` covers the real verifier with a throw-away key. Demo accounts (one per role, password in the script) are created with `apps/api/scripts/create-demo-users.mts`. The web app needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the publishable key) to sign people in.

## 8. Persistence (Supabase, optional)

**Several instances, one database.** The laptop and the Railway deployment share the same Supabase. Each instance loads everything at startup and then, every `SYNC_INTERVAL_MS` (10 s), pulls rows newer than its own copy and drops rows that were deleted elsewhere (`persistence.refresh`, planned by the pure `planSync`), then emits `case_changed` so open browsers update. A case this instance is investigating or writing is never replaced. Settings are not synced: each instance keeps its own SAP and AI mode. `POST /api/demo/reset` removes only the eight demo cases (ids from `FIXTURES`) and resets settings and the evaluation; complaints from emails, uploads and typed complaints are kept, because every teammate's instance shares the database. The backend logs who called it. Several instances may listen on the same mailbox: an email's case id is derived from its Message-ID (`caseIdForMessage`), and the case row is *inserted*, not upserted, so the first instance to insert ingests and runs it; the others get a duplicate-key answer, skip it, and receive the case through the sync loop.

`SUPABASE_URL` + `SUPABASE_SECRET_KEY` turn on write-through persistence (`src/persistence.ts`). The in-memory `Store` stays the working copy; every touched case is upserted into `public.cases` (whole case as JSON plus a few columns for reporting), SAP writes into `public.sap_writes`, settings into `public.settings`, evaluation runs into `public.eval_runs`. At startup all cases are loaded back. A database error is logged and never fails a request. Create the tables once with `apps/api/supabase/schema.sql` in the Supabase SQL editor. The health route reports `persistence: true` when it is on.

## 9. How complaints get in

Three channels, all ending in `service.ingestInbound()` and, unless `INBOUND_AUTORUN=false`, an automatic run:

1. **Mailbox (IMAP, push).** Set `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD` (Gmail: enable IMAP, two-step verification, app password). `src/intake/mailbox.ts` keeps one connection open in IDLE mode: the server notifies it the moment a message arrives, it fetches the unseen messages, parses them with mailparser, saves the attachments under `apps/api/uploads` (local disk: on Railway they do not survive a redeploy without a volume) (served at `/uploads/…`, linked with `PUBLIC_URL`) and marks them seen. It reconnects with backoff if the connection drops and runs a safety sweep every `IMAP_POLL_MS` (min 60 s). Duplicate message ids are ignored. This is the demo path: send the complaint from a phone, watch it appear within seconds.
2. **Webhook.** `POST /api/inbound` with JSON `{from, subject, text, receivedAt?, messageId?, attachments?}` or a raw email as `message/rfc822`. Returns 201 with the case summary, or `{duplicate: true}`. Works from Postman or any email-to-webhook service.
3. **Upload / seed.** `POST /api/cases/ingest` (multipart `.eml` files, parsed with mailparser) and `POST /api/cases/seed` for the eight demo cases.

## 10. Live updates

`GET /api/events` is Server-Sent Events: `data: {"type":"case_changed","id":"case-01"}` or `{"type":"status_changed"}`, with `: ping` comments every 25 s. The frontend invalidates its queries on every event and falls back to polling if SSE is unavailable.

## 9. What is left to do, in priority order

1. Run the frontend against this backend (`VITE_API_MODE=http`) and walk `docs/demo-script.md` end to end.
2. Wire `RealGateway` to Alex's service: verify `toSnapshot` against a live `getInvoice`, get the missing reason names and response shapes (§6), do **one** real `createCreditMemoRequest` on a team invoice, then one release.
3. Set `ANTHROPIC_API_KEY`, run the acceptance test in assisted mode, read a few explanations and replies, tune the two system prompts in `ai/claude.ts` if needed.
4. Deploy: `apps/api` on BTP Cloud Foundry (Node buildpack, `PORT` from the platform, env vars above), the web build behind the approuter, `VITE_API_BASE` pointing at the API.
5. Only if time remains: persistence in Supabase (replace `Store`), policy retrieval, case chat.

## 11. Known limitations (say them if asked; do not hide them)

- **R4 price-difference credit.** When the agreed price is below the invoiced one, the decision is "credit the difference", but the YCR payload carries only the quantity with reference to the invoice. SAP would copy the invoice price and credit the full line value. A correct implementation needs a manual price condition on the credit request, which must be verified on DS4 first. The demo data never reaches this path (agreed price equals invoiced). Until fixed, a credit manager must correct the amount in SAP after release, or the rule can be changed to send the case to a person.
- **Customer identity.** Uploaded emails default to customer 10021; once the invoice is read, the case takes the customer from the invoice. There is no table from sender address to SAP customer, so the agent does not verify that the complaining party owns the invoice.
- **Multi-line invoices.** The line matching the material named in the email is used (`preferItem`); when no material is named, the first line is. Check how many lines the team's real DS4 invoices have.
- **Release of a return.** SAP's goods receipt is asked first (`getReturnStatus`); the manual confirmation remains as an override for the mock, which has no warehouse, and it is recorded as manual in the audit trail. Nobody has yet seen the live status go to "received" on DS4.
- **No real write yet.** Every write path is tested against the mock and the stubbed contract; the first create and release against DS4 still has to be done on one of the team's own invoices.
- **Rejections** are not sent to the gateway's approval log; only approved requests get a record.

## 12. Rules that must not be broken

- Quantity never exceeds the invoiced quantity; amount never exceeds the invoice line.
- Every YRE and YCR carries `HeaderBillingBlockReason: "08"`.
- No SAP write without an approval record; the approved payload is sent byte for byte.
- SAP write failures are returned with their HTTP status and SAP's message; never retried blindly.
- Demo invoices are never written to the real system.
- Every step produces an audit event with its L4 id where one applies (`5.1.1` check, `5.1.2` create return, `5.1.3` goods receipt, `5.2.1` create/release credit request, `5.2.2` intercompany flag).

## 13. Control Tower (extra credit, agent 10)

A second agent in the same product, read-only by construction: it has no write call anywhere (`src/control-tower.ts`, `packages/shared/src/control-tower/`). It reads the SAP lists (today: the organisers' pack in `mock-data/control-tower/mock-data/sap-responses`, real DS4 answers of 1 Oct 2026; a live run fills the same `PackFiles` from gateway reads), runs the pure `runScan` (rules S1–S12 of the guide with their thresholds: grace 3 days, high after 14, blocks high after 30, overdue high from 10 000, legacy older than a year, period = the month being closed), and produces KPIs per currency (EUR and RON never added), one finding per leak with L4 step, severity, rule, reason with numbers, route and data owner, the close verdict (S9) and the memo in the template's shape (`buildMemo`). A delivery that is unbilled and awaiting POD is one finding, cause POD. Lists cut at their row cap are reported as such.

Questions (`answerQuestion`) are parsed by code (country, customer, order, topic) and answered from the snapshot only; "no data" for a subject SAP holds nothing about (Norway), and a request to change SAP is refused and routed to the block owner. In assisted mode the model words the answer (`Ai.phrase`) from the computed facts and may not add a figure; rules-only wording is the fallback. Routing notes: one per fixing agent per day, information only. A finding for the Returns & Credit Note agent (a return older than 7 days without a credit memo, read from our own cases) is handed into our inbox with `POST /api/control-tower/handover/:id`.

Routes: `GET /api/control-tower/snapshot`, `POST /run`, `POST /ask {question}`, `GET /memo` (markdown), `GET /notes`, `POST /handover/:findingId`. Tests: `packages/shared/src/__tests__/control-tower.test.ts` checks the scan and the seven questions against the organisers' `expected-results.json`; the acceptance test covers the routes.


## 14. Root causes (Insights, read-only)

Why money leaks through complaints, and what to fix upstream. `POST /api/insights/root-causes` builds a briefing over every investigated case plus `COMPLAINT_ARCHIVE` (34 closed complaints, sample data, in `packages/shared/src/fixtures/archive.ts`); `GET` returns the last one (null before the first; the demo reset clears it). Read-only: it never changes a case and never calls SAP (`src/insights/root-causes.ts`).

1. **Group by meaning.** Assisted mode: each complaint (core text without greeting, signature, invoice number or customer name, plus the model's photo evidence) is embedded with Cohere Embed Multilingual v3 on Bedrock (`EMBEDDING_MODEL`, `src/insights/embeddings.ts`), so a German and a Romanian complaint about the same lids land together. Vectors are cached in Supabase pgvector (`complaint_embeddings`, keyed by id, model and text hash; run the block at the end of `schema.sql`), or in memory without it. Vectors are mean-centred, then grouped by average-linkage clustering (threshold 0.15; at least three complaints per group). Rules-only mode, or when Bedrock fails: local TF-IDF (threshold 0.3), said so in the briefing.
2. **Code computes every figure** (`packages/shared/src/root-causes.ts`): credit value, share of all credit, desk hours (45 min per complaint), last 30 days against the 30-day average of the 60 before, trend, plants, materials, customers, open cases.
3. **The model names cause, action and owner** (`ClaudeAi.explainRootCauses`, purpose `insights`) from the computed facts and quotes. Every run of digits in its wording must appear in the prompt (`isGrounded`); otherwise that group gets template wording and a note. The figures are identical with or without the model (tested).

The web shows it as **Root causes** at the top of Insights: one line per problem (top three), details in a side panel, and a one-page PDF (`rootCausesPdf` in `apps/web/src/features/reports/export.ts`).

Tests: `packages/shared/src/__tests__/root-causes.test.ts` (the four hidden patterns, the figures, the grounding check), `apps/api/test/root-causes.test.ts` (routes, fake model with an invented figure, read-only), `apps/web/src/features/analytics/__tests__/RootCausesPanel.test.tsx`.
