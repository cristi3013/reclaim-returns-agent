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
  ai/             Ai interface; RulesOnlyAi (no model); ClaudeAi (extract facts from email+photo, narrate)
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
2. **Extract** (`ai.extractFacts`). Email text + photo → `Facts`: invoice number or null, material, claimed quantity, complaint type, claimed price, wants replacement, goods returnable, evidence, language. ClaudeAi uses structured output with the shared `FactsSchema`; RulesOnlyAi uses regex. Event kind `model` or `rule`, L4 `5.1.1`.
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
- YRE → `gateway.createReturn(payload)`, YCR → `gateway.createCreditMemoRequest(payload)`. The payload is `proposal.sapPayload`, built by `buildSapPayload`, sent unchanged. Success → `SapDocument` stored, status `written_to_sap`, event `sap_write` with L4 `5.1.2` or `5.2.1`. Failure → status `sap_write_failed`, event `error` with the HTTP status and SAP's message; the route returns that status (412 on conflict).
- `release(documentId, {actor, role, goodsReceived?})` → `gateway.release({type, number})`. Removing billing block 08 is the credit decision itself, so: same role as the approval (403 otherwise), only once (409 on repeat), refused if the create response did not confirm block 08, and for a return (YRE) only with `goodsReceived: true`, because the policy credits after the goods arrive (step 5.1.3). The gateway re-reads the document right before the PATCH and sends its current ETag as If-Match; a change since then is a 412.
- Approve order of operations: the edited decision is computed in local variables first, every check runs (quantity > 0, role vs the re-derived approver, SAP-mode match, demo-invoice guard), and only then is the proposal changed and the write attempted. A refused approval changes nothing.
- A proposal is stamped with the SAP mode it was investigated in. Approving it in another mode is a 409: re-run the case first. Switching to real mode without `GATEWAY_URL` is refused.
- After a successful create the response's `HeaderBillingBlockReason` is checked. If it is present and not `08`, the document is recorded, an error event says it was created without the block, and release is refused.

## 6. The gateway contract (Alex's CAP service on BTP)

The gateway is the only thing that talks to SAP DS4 (through Destination + Cloud Connector). Every function returns `{ "value": "<JSON string>" }`; `RealGateway.unwrap()` parses it.

| Our method | His function | Status 5 Oct | Notes |
|---|---|---|---|
| getInvoice | `getInvoice(invoiceNumber)` | done | raw OData v2 billing document; we map it in `toSnapshot`, keep `__metadata.etag` |
| checkExistingCredits | `checkExistingCredits(invoiceNumber)` | done | `{existingReturns:[], existingCredits:[]}` |
| createReturn | `createReturn(invoiceNumber, invoiceItem, material, quantity, unit, reason, soldToParty)` | done | we also send `customerReference` (PurchaseOrderByCustomer); ask him to accept it. Must create with reference to the invoice item or SAP makes a normal sale (item category TAN instead of REN) |
| createCreditMemoRequest | `createCreditMemoRequest(invoiceNumber, material, quantity, unit, reason, soldToParty)` | done | gateway must set HeaderBillingBlockReason 08 itself |
| release | `releaseCreditMemoRequest(number, type)` | **missing** | The gateway must GET the document, take its ETag, then PATCH `HeaderBillingBlockReason: ""` with `If-Match`; 412 on conflict. We pass only the number. Needed for the demo's release step and the 412 story |
| getAgreedPrice | `getAgreedPrice(material, salesOrg, channel)` | **missing** | `API_SLSPRICINGCONDITIONRECORD_SRV`, condition PR00. Needed for case 02 |
| findInvoices | `findInvoices(customer, material, dateFrom, dateTo)` | **missing** | `A_BillingDocumentItem` filtered, then headers. Needed for case 05 |
| getPlantCompanyCode | none | n/a | our own table `{ YGLG: 'YDE1', YRO1: 'YRO1' }` in `gateway/real.ts` |

The names and shapes for the three missing ones are our proposal; adjust `gateway/real.ts` to whatever he ships. Reads are safe to call any time. **Writes only against the team's own four invoices on DS4** (guarded in the service and again in `RealGateway`).

Lookups that may be missing on the gateway (`findInvoices`, `getAgreedPrice`, the plant table) are **optional**: a failure is recorded as an error event and the rules decide with what is known. A price complaint without an agreed price goes to the credit manager as "no automatic decision". `getInvoice` failing aborts the run.

Ask Alex to accept the full payload object on the two creates instead of flat parameters. Today `RealGateway` maps `sapPayload` onto his parameters, so "sent unchanged" holds up to the gateway, and billing block 08 depends on his service. The response check above is the safety net.

SAP facts that bite (from the hackathon guide): writes need a CSRF token fetched with a GET first plus the session cookies (the gateway handles it); a return item needs both `ReferenceSDDocument` and `ReferenceSDDocumentItem`; a released credit memo request is not posted to accounting automatically on DS4 (stop the demo at the release); OData v2 dates are `/Date(ms)/` and numbers are strings.

## 7. The model (ClaudeAi)

Two calls, both with `client.messages.parse` and `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`, model `claude-opus-5-5`:

- **extractFacts**: system prompt describes each field; the email (and photo as an image block) is the user message; output format is the shared `FactsSchema`. Effort `medium`. A refusal or unparsable output throws 502 and the run fails cleanly (status back to `received`, error event).
- **narrate**: gets the rule text, the SAP facts, the extracted facts and the decision; returns explanation, reply, briefing. Effort `low`, system prompt cached. On refusal it falls back to the template narrative.

The acceptance test runs rules-only by default. With `ANTHROPIC_API_KEY` set and `AI_MODE=assisted`, it runs with the model and the decisions must still match: that is the proof that the model never decides.

Ideas that fit later, in order of value: a chat endpoint over one case (read-only tools over cases/events), language detection and replies in the customer's language (the facts already carry `language`), anomaly hints from case history (partly done), policy-gap detection (done: rule NONE → `awaiting_approval` for the customer service lead), policy retrieval with embeddings (Supabase pgvector) to ground the explanation on a larger corpus.

## 8. Live updates

`GET /api/events` is Server-Sent Events: `data: {"type":"case_changed","id":"case-01"}` or `{"type":"status_changed"}`, with `: ping` comments every 25 s. The frontend invalidates its queries on every event and falls back to polling if SSE is unavailable.

## 9. What is left to do, in priority order

1. Run the frontend against this backend (`VITE_API_MODE=http`) and walk `docs/demo-script.md` end to end.
2. Wire `RealGateway` to Alex's service: verify `toSnapshot` against a live `getInvoice`, confirm the parameter names of the three missing functions, do **one** real `createCreditMemoRequest` on a team invoice, then one release.
3. Set `ANTHROPIC_API_KEY`, run the acceptance test in assisted mode, read a few explanations and replies, tune the two system prompts in `ai/claude.ts` if needed.
4. Deploy: `apps/api` on BTP Cloud Foundry (Node buildpack, `PORT` from the platform, env vars above), the web build behind the approuter, `VITE_API_BASE` pointing at the API.
5. Only if time remains: persistence in Supabase (replace `Store`), policy retrieval, case chat.

## 10. Known limitations (say them if asked; do not hide them)

- **R4 price-difference credit.** When the agreed price is below the invoiced one, the decision is "credit the difference", but the YCR payload carries only the quantity with reference to the invoice. SAP would copy the invoice price and credit the full line value. A correct implementation needs a manual price condition on the credit request, which must be verified on DS4 first. The demo data never reaches this path (agreed price equals invoiced). Until fixed, a credit manager must correct the amount in SAP after release, or the rule can be changed to send the case to a person.
- **Customer identity.** Uploaded emails default to customer 10021; once the invoice is read, the case takes the customer from the invoice. There is no table from sender address to SAP customer, so the agent does not verify that the complaining party owns the invoice.
- **Multi-line invoices.** The line matching the material named in the email is used (`preferItem`); when no material is named, the first line is. Check how many lines the team's real DS4 invoices have.
- **Release of a return.** `goodsReceived` is a human confirmation, not a lookup of the returns delivery (`API_CUSTOMER_RETURNS_DELIVERY_SRV;v=0002`). A later version should read `GoodsMovementStatus`.

## 11. Rules that must not be broken

- Quantity never exceeds the invoiced quantity; amount never exceeds the invoice line.
- Every YRE and YCR carries `HeaderBillingBlockReason: "08"`.
- No SAP write without an approval record; the approved payload is sent byte for byte.
- SAP write failures are returned with their HTTP status and SAP's message; never retried blindly.
- Demo invoices are never written to the real system.
- Every step produces an audit event with its L4 id where one applies (`5.1.1` check, `5.1.2` create return, `5.1.3` goods receipt, `5.2.1` create/release credit request, `5.2.2` intercompany flag).
