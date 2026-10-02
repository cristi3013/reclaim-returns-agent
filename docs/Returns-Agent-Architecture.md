[[_TOC_]]

# Returns Agent Architecture

**O2C Agent 8 · Returns & Credit Note · Hackathon architecture · Draft v1.1 · 2 Oct 2026**

How a customer complaint becomes an approved SAP return or credit. Two views: the functional one for anyone who needs to understand what the application does, and the technical one for the people building it.

Sources: hackathon guide, `mock-data/` folder, organizer hints, the gateway endpoints already deployed on BTP.

---

## The one sentence to remember

**The model reads and explains. Code decides about money. A named person approves every change to SAP.**

The organizer's own reference app has the same tagline, so this is the baseline the jury expects. Everything below is built so that sentence is visibly true on screen.

| Who | Does |
|---|---|
| **Model (Claude)** | Reads the email and photo, extracts the facts, decides which lookups to run, writes the explanation and the customer reply, grounded in retrieved policy text. |
| **Code (rules engine)** | Applies R1 to R9 deterministically. Caps quantity at the invoiced amount. Picks the approver from the threshold table. Always sets billing block 08. Flags intercompany. |
| **Person (approver)** | Sees the exact SAP payload, approves, rejects or edits. Only then does the backend write to SAP, with the token handshake and the version stamp (ETag). |

---

## 1 · Functional view

What happens to one complaint, who does what, and which step of the standard SAP process (the L4 IDs) each action maps to.

### Complaint flow

::: mermaid
graph LR
  subgraph customer [CUSTOMER]
    EMAIL["Complaint email, sometimes a photo"]
    ASK["Ask customer or hand over: R6 R7 R8 R9, no SAP document"]
    REPLY["Reply to customer: decision and document number"]
  end
  subgraph agent [AGENT, automatic]
    S1["1 Read and extract (5.1.1)"]
    S2["2 Find the history: invoice, delivery, order (5.1.1)"]
    S3["3 Apply policy R1-R9, cap qty, approver, IC flag (5.1.1, 5.2.2)"]
    S4["4 Proposal: payload, rule cited, reply draft"]
    S7["7 Log and reply, track receipt (5.1.3)"]
  end
  subgraph approver [APPROVER, a named person]
    S5["5 Approve, reject or edit, by value threshold"]
  end
  subgraph sap [SAP DS4, via gateway]
    READ[("Invoice and history, existing credits, agreed price")]
    WRITE[("6 YRE or YCR created, billing block 08, with reference (5.1.2, 5.2.1)")]
  end
  EMAIL --> S1
  S1 --> S2
  S2 --> S3
  S3 --> S4
  S4 --> S5
  S2 -- reads only --> READ
  READ --> S2
  S3 -. no document .-> ASK
  S5 -- writes only if approved --> WRITE
  WRITE --> S7
  S7 --> REPLY
:::

Steps 1 to 4 run without a person. Nothing reaches SAP before step 5. Rules R6 to R9 end in the customer lane: the agent asks the customer or hands over, and no SAP document is created. The L4 IDs are the process step codes the organizers want reported.

### Case lifecycle

Every complaint is a case with one status. The UI, the analytics and the Control Tower status endpoint all read this field.

::: mermaid
graph LR
  A["received"] --> B["investigating"]
  B --> C["proposed"]
  C --> D["awaiting approval"]
  D --> E["approved"]
  E --> F["written to SAP"]
  F --> G["closed"]
  C -.-> X1["needs customer input: R7, R9"]
  C -.-> X2["handed over to customer service: R6"]
  C -.-> X3["duplicate, replied with existing number: R8"]
  D -.-> X4["rejected by approver"]
  E -.-> X5["SAP write failed: shown, never retried blindly"]
:::

### Rules and what the seven demo emails prove

The policy has nine rules. The mock emails were written so that each rule is exercised at least once. The expected outcome comes from the organizers' test oracle (`expected-results.json`), which the evaluation tab runs automatically.

| Email | Situation | Rule | Agent outcome | SAP document | Approver |
|---|---|---|---|---|---|
| 01 damaged | 2 of 5 KG leaking, photo attached, invoice 90000353 | R1 / R3 | Both options proposed, person picks. Photo read by the model. 540 EUR | YRE reason 102, or YCR reason 104 | Credit manager |
| 02 price | Claims 260 EUR/KG agreed, invoice 90000354 | R4 | Agreed price in SAP is 270, same as invoiced. Claim not supported. Reply drafted with the evidence | none unless a person confirms a special deal | Credit manager |
| 03 short | 20 KG invoiced, 18 arrived, invoice 90000355 | R5 | Credit the 2 KG missing, 540 EUR, ask warehouse for proof of delivery | YCR reason 103 | Credit manager |
| 04 over qty | Wants to return 10 KG from an 8 KG invoice | R7 | Refuse, ask the customer to correct | none | – |
| 05 no invoice | "15 KG received last week is discoloured", no number | R9 | Search customer's invoices by material and date, propose 90000357, ask to confirm | none until confirmed, then YRE 101 | – |
| 06 duplicate | Follow-up on email 01 | R8 | Find the existing document for 90000353, reply with its number, create nothing | none | – |
| 07 replacement | Wants new goods, not money, invoice 90000358 | R6 | Hand over to customer service for a free re-delivery | none (flag) | – |
| 08 intercompany | *We write this one.* Sold by YDE1, shipped from a YRO1 plant | R1 + IC | Normal return plus an intercompany flag for finance | YRE + flag | per value |

> **Demo order matters.** Email 06 is only a duplicate if email 01 has already produced a document. Run 01, approve it, then run 06. Also: the mock invoices 90000353 to 90000358 must never be posted to the real DS4. Real writes use the four invoices assigned to the team on the day.

### Approval thresholds (in code, never in a prompt)

| Credit value | Approver role |
|---|---|
| up to 500 EUR | Customer service lead |
| 500 to 5 000 EUR | Credit manager |
| above 5 000 EUR | Finance director |

Any credit without goods coming back (R3, R4, R5) goes to the credit manager at least, whatever the value.

### Screens and who uses them

No login. A role switcher in the header sets the current user and filters the approval queue. Roles: customer service lead, credit manager, finance director, returns desk.

| Screen | Users | What it shows |
|---|---|---|
| **Inbox** | everyone, landing page | Every complaint as a row: customer, invoice, detected type, rule, proposed action, amount, status. Live updates while the agent works. "Run all" and "Upload .eml" buttons for the demo. Mode switches: mock / real SAP, rules-only / AI-assisted. |
| **Case** | everyone, the core screen | Left: the email and photo. Right: what was found in SAP as a chain (order, delivery, invoice), agreed price, existing credits. Below: the proposal with the cited policy text, the exact SAP payload, approver, intercompany flag, reply draft. Two options side by side for R1/R3. |
| **Approvals** | approver roles | Queue filtered to the current role's threshold. Approve, reject with a comment, or edit the quantity. On approve the SAP document number appears. A failed write (412 conflict, SAP error text) is shown as is. |
| **Audit trail** | everyone, per case | Timeline of every step with its L4 ID, every gateway call with request and response, the model's inputs and outputs, who approved and when. Exportable as JSON. |
| **Analytics** | management | Complaints by type and week, credit value approved vs rejected, time from email to approval, proposals accepted unchanged, duplicates prevented, intercompany flags. Plus the value calculator from the guide with editable assumptions. |
| **Evaluation** | engineering, proof of correctness | Runs the seven mock emails against `expected-results.json`: rule, document type, reason code, quantity, amount, approver. Green or red per case. Run live on stage. |

---

## 2 · Technical view

A cloud-agnostic web application deployed on SAP BTP. The only component that knows SAP exists is the gateway Alex built. Everything else is a normal TypeScript application with Postgres behind it.

### Component diagram

::: mermaid
graph LR
  EML["Complaint emails: .eml files, later a mailbox"]
  BROWSER["Browser: React + Vite + TypeScript"]
  CLAUDE["Claude API: tool use, vision, structured output"]
  SUPA[("Supabase: Postgres, pgvector, Storage, Realtime")]
  subgraph btp [SAP BTP, Cloud Foundry trial]
    APPROUTER["approuter: serves UI build, proxies /api"]
    BACKEND["Backend Node + TS: intake, rules engine, agent, approvals, audit, eval, status endpoint"]
    GATEWAY["SAP gateway (CAP): OData v4 functions, CSRF token, ETag, cookies"]
    MOCK["Mock gateway: captured JSON, same contract"]
  end
  subgraph client [Client network]
    CC["Cloud Connector"]
    DS4[("DS4 S/4HANA, OData v2")]
  end
  EML -- upload, ingest --> BACKEND
  BROWSER -- HTTPS --> APPROUTER
  APPROUTER -- /api --> BACKEND
  BACKEND -- extract, explain, draft --> CLAUDE
  BACKEND -- cases, events, proposals, policy chunks, attachments --> SUPA
  SUPA -. realtime: case updates .-> BROWSER
  BACKEND -- JSON --> GATEWAY
  BACKEND -. SAP_MODE=mock .-> MOCK
  GATEWAY -- Destination --> CC
  CC --> DS4
:::

The backend never speaks OData. It calls the gateway's functions over HTTPS and switches to the mock by configuration. Supabase is reached over the internet from BTP, same as any hosted database. HANA Cloud would be a drop-in swap for a client who mandates it, because the schema is plain Postgres.

### Where things run

| Component | Technology | Runs on | Knows about SAP? |
|---|---|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind + a component kit, TanStack Query, Supabase JS client for realtime | Static build served by the approuter on Cloud Foundry | No |
| Backend | Node 20, TypeScript, Fastify or Express, Zod schemas, Anthropic SDK, postal-mime for .eml, Supabase client | Cloud Foundry (Node buildpack), listens on `PORT` | Only through the gateway client |
| SAP gateway | CAP (Node), Destination + Connectivity services, Cloud Connector | Cloud Foundry, already deployed by Alex | Yes, the only one |
| Mock gateway | Small Node server replaying the captured DS4 JSON, simulating create and release | Local, or as a second CF app for a stage fallback | Pretends to |
| Database | Supabase: Postgres, pgvector, Storage (attachments), Realtime | Supabase cloud | No |
| Model | Claude API, a Claude 5 model, tool use and vision | Anthropic | No, it sees typed tool results |

### One case, end to end

::: mermaid
sequenceDiagram
  participant UI
  participant BE as Backend
  participant DB as Supabase
  participant LLM as Claude
  participant GW as Gateway to DS4

  UI->>BE: POST /cases/{id}/run
  BE->>DB: status=investigating · event 5.1.1
  BE->>LLM: extract facts from email + photo (structured output)
  LLM-->>BE: {invoice, material, qty, complaintType, wantsReplacement}
  BE->>GW: getInvoice(no) · or findInvoices(customer, material, dates) when no number
  GW-->>BE: header + items + ETag · order and delivery numbers
  BE->>GW: checkExistingCredits(no) · getAgreedPrice(material, salesArea)
  GW-->>BE: existing documents · PR00 price
  Note over BE: Rules engine: R1-R9, cap quantity, amount, approver by threshold, intercompany flag
  BE->>DB: search policy chunks (pgvector)
  DB-->>BE: cited rule text
  BE->>LLM: explain decision + draft reply, grounded in rule text and SAP facts
  LLM-->>BE: explanation, reply draft, approver briefing
  BE->>DB: save proposal · status=awaiting approval
  DB-->>UI: realtime: case changed
  UI->>BE: POST /cases/{id}/approve
  BE->>GW: createReturn(payload) or createCreditMemoRequest(payload) · exactly what was approved
  GW-->>BE: document number, or SAP error text, or 412 conflict
  BE->>DB: audit event 5.1.2 / 5.2.1 · status=written to SAP
:::

The two places where the outcome is decided: the rules engine, which runs entirely in the backend, and the write to SAP, which sends the approved payload unchanged. In rules-only mode the two Claude calls are skipped and a template explanation is used instead.

### Gateway contract (Alex's service)

The backend talks to the gateway through one TypeScript interface. The real client calls the CAP functions and unwraps the JSON string in `value`. The mock implements the same interface from the captured responses. Nothing else in the codebase may import either directly.

| Function | Input | Returns | SAP call behind it | Status |
|---|---|---|---|---|
| `getInvoice` | invoiceNumber | header, items, ETag | `A_BillingDocument(no)?$expand=to_Item` | done |
| `checkExistingCredits` | invoiceNumber | existingReturns[], existingCredits[] | `A_CustomerReturnItem` and `A_CreditMemoRequest` filtered by ReferenceSDDocument | done |
| `findInvoices` | customer, material, dateFrom, dateTo | candidate invoices with qty, amount, date | `A_BillingDocumentItem` filtered, then headers | needed · R9 |
| `getAgreedPrice` | material, salesOrg, channel | PR00 price, unit, validity | `A_SlsPrcgCndnRecdValidity` + condition record | needed · R4 |
| `createReturn` | YRE payload (sales area, customer, reason, items with invoice reference and item) | return number | `POST A_CustomerReturn` (token fetch first) | needed · R1 R2 |
| `createCreditMemoRequest` | YCR payload (reason, block 08, invoice reference, items) | request number | `POST A_CreditMemoRequest` (token fetch first) | needed · R3 R4 R5 |
| `releaseCreditMemoRequest` | number, etag | ok, or 412 conflict | `PATCH HeaderBillingBlockReason=""` with If-Match | needed · approval |
| `getReturnStatus` | return number | items, goods receipt status | `A_CustomerReturn` + returns delivery (v0002), GoodsMovementStatus | nice to have · 5.1.3 |

Error contract: on failure the gateway returns the readable SAP message unchanged, plus the HTTP status. The backend shows it and never retries a write by itself. On success the gateway returns the SAP document number. An ETag from a read must be returned so the backend can pass it to the release call.

### Data model (Supabase, Postgres)

| Table | Holds |
|---|---|
| `cases` | one row per complaint: subject, sender, received_at, raw email, status, customer, invoice, detected type, mode used (rules-only / ai), eval tag |
| `case_events` | the audit timeline: case_id, l4_step, kind (lookup, rule, model, approval, sap_write), payload, duration, created_at |
| `sap_snapshots` | what SAP answered at investigation time: invoice JSON, existing credits, agreed price, ETag |
| `proposals` | one or two per case: rule, document_type (YRE/YCR/none), reason_code, material, quantity, amount, approver_role, intercompany flag, sap_payload, explanation, reply_draft, policy_citations |
| `approvals` | proposal_id, actor, role, decision, edited_quantity, comment, decided_at |
| `sap_documents` | what was created: case_id, type, number, request payload, response, created_at |
| `policy_chunks` | text, source, rule_ref, embedding (vector) · the policy plus the extended corpus |
| `ref_plants` | plant → company code, for the intercompany check |
| `eval_runs` | run_id, email, expected, actual, pass per field |

::: mermaid
erDiagram
  cases ||--o{ case_events : "timeline"
  cases ||--o| sap_snapshots : "what SAP answered"
  cases ||--o{ proposals : "one or two"
  proposals ||--o{ approvals : "decisions"
  cases ||--o{ sap_documents : "created in SAP"
  cases ||--o{ eval_runs : "oracle comparison"
:::

- **Attachments** go to Supabase Storage, keyed by case id. The model receives a signed URL or the bytes.
- **Realtime** is enabled on `cases` and `proposals`. The inbox and the approval queue subscribe and never poll.
- **Analytics** are SQL views over these tables: cases by week and type, approved value, time to approval, proposals accepted unchanged, duplicates prevented. No separate warehouse.
- **Policy corpus.** The nine rules alone are too small to justify retrieval. Extend the corpus with text we write: reason code definitions, the approval matrix, intercompany guidance, two or three customer-specific clauses. Chunk by section, embed once at startup. Hybrid search: vector plus Postgres full text, merged.
- **Case memory.** Past complaints are embedded too. Duplicate detection (R8) first checks SAP for an existing document on the invoice, then checks our own cases for a similar complaint from the same customer. Both signals are shown.

### Backend API

| Method · path | Does | Used by |
|---|---|---|
| `POST /api/cases/ingest` | Upload one or more .eml files, parse, store attachments, create cases in status received | Inbox |
| `POST /api/cases/seed` | Load the seven mock emails plus our intercompany one | Demo |
| `GET /api/cases` · `GET /api/cases/:id` | List, and full detail with snapshot, proposals, events | Inbox, Case |
| `POST /api/cases/:id/run` | Run the pipeline: extract, investigate, rules, explain, propose | Inbox, Case |
| `POST /api/cases/run-all` | Run every case in status received, in order | Demo |
| `POST /api/proposals/:id/choose` | For R1/R3 cases: pick which option goes to approval | Case |
| `POST /api/proposals/:id/approve` · `/reject` | Record the decision; on approve, call the gateway write and store the result | Approvals |
| `POST /api/sap/:docNumber/release` | Remove billing block 08 after approval, with ETag | Approvals |
| `GET /api/analytics/summary` | Aggregates for the dashboard | Analytics |
| `POST /api/eval/run` · `GET /api/eval/latest` | Run the oracle comparison, return pass/fail per field | Evaluation |
| `GET /api/status` | agent name, cases, pending approvals, last run, mode | Control Tower, header badge |
| `GET/PUT /api/settings` | sap_mode (mock / real), ai_mode (rules-only / assisted), current role | Header switches |

### Agent design

**Call 1 · extract.** Input: email text, subject, sender, the photo if any. Output, as a strict schema: invoice number or null, material, claimed quantity and unit, complaint type (damaged, ruined, quality, price, short, over, replacement, follow-up), claimed price, whether goods can be returned, free-text evidence. Vision is used only here.

**Call 2 · investigate.** Tool-use loop with four read-only tools that wrap the gateway: `getInvoice`, `findInvoices`, `checkExistingCredits`, `getAgreedPrice`. The model decides which to call and in what order (for email 05 it must search before it can read). Every call is logged as a case event. The loop ends with a typed "findings" object.

**Rules engine (no model).** Pure function: facts + findings → decision. Returns rule id, document type, reason code, quantity (capped), amount (quantity × invoice unit price), approver role, intercompany flag, and for R1/R3 both candidate decisions. Unit-tested against the oracle.

**Call 3 · explain.** Input: decision, findings, retrieved policy chunks. Output: a short explanation that quotes the rule, a customer reply draft, and a three-line approver briefing. The model may not change any number; the UI renders numbers from the decision object, never from the model text.

**Rules-only mode** skips calls 1 and 3 and replaces call 2 with a fixed lookup sequence. Extraction then falls back to regex for invoice numbers and quantities. It proves the pipeline does not depend on the model to be correct, and it is the stage fallback if the API is slow.

**Guardrails in code, not prompts:** quantity never above invoiced, amount never above the invoice line, document type only from the rule table, billing block always 08, SAP payload built by code from the decision, approval required before any write, write sends the approved payload byte for byte.

**Evaluation** compares the decision object to `expected-results.json` field by field: rule, document, reason, quantity, amount, approver. The model's prose is not scored. This keeps the eval deterministic even though the explanation varies.

> **Why this is honest RAG.** Retrieval feeds the explanation, not the decision. If a partner asks "why embeddings for nine rules", the answer is on screen: the cited passage comes from a corpus that grows with every client policy and every past case, and the decision itself never depended on it.

### Beyond read and explain: model features worth adding

None of these touches a number, a document type or SAP. They all sit on top of the case data and the audit trail, so they can be added late without destabilising the pipeline. Ranked by value for the demo against effort. Do them in this order and stop when time runs out.

| # | Feature | What the jury sees | How it works | Effort |
|---|---|---|---|---|
| 1 | **Approver briefing** | Three lines at the top of every queue item: what happened, what we propose, what the risk is | Part of the existing explain call, one more field in the output schema | small |
| 2 | **Chat on a case** | Approver asks "why not a replacement?" or "what did we do last time for this customer?" and gets an answer grounded in this case and past cases | One endpoint, model with read-only tools over cases, events and proposals. Answers cite the event or the past case | medium |
| 3 | **Language** | A German complaint comes in, the facts are extracted, the reply goes out in German. The jury is German | Extraction is language-agnostic already. Add a detected language field and ask for the reply in it. Write one German mock email | small |
| 4 | **Anomaly hints** | "Third complaint from this customer this month", "amount unusually high for material 54" | SQL over our own cases, rendered as chips on the case. No model needed for the first version | small |
| 5 | **Policy gap detection** | When no rule fits, the agent says so and proposes how the policy should be extended, instead of forcing a match | Rules engine returns "no rule"; explain call gets a different prompt; proposal shows as "needs policy decision" | medium |
| 6 | **Attachments beyond photos** | A delivery note PDF as evidence, read and cross-checked against the SAP delivery quantity | PDF to the model in the extract call, compare to the gateway's delivery data. Needs a mock PDF and a delivery lookup | larger |

> **The boundary stays.** The model may recommend, summarise, answer, translate and flag. It never sets quantity, amount, document type or billing block, and it never writes to SAP. Every feature above is phrased so that the boundary is visible on screen.

---

## 3 · Modules and build order

Five streams that can run in parallel from the first hour, because the contracts between them are the gateway interface, the decision object and the database schema. Agree those three in the kickoff, then split.

| Stream | Owner | Scope |
|---|---|---|
| **A · SAP gateway & BTP** | Alex | Remaining gateway functions, writes first. Deploy backend + approuter to CF, env config, deploy script. Prove one real create on a team invoice. |
| **B · Backend core** | 1 person | Gateway interface + mock from captured JSON. .eml parser, case store, events. Rules engine + eval runner against the oracle. |
| **C · Agent layer** | 1 person | Extract call with schema, photo input. Tool-use investigate loop. Policy corpus, embeddings, hybrid search, explain + reply. |
| **D · Frontend** | 1 to 2 people | Shell, role switch, mode switches, realtime. Inbox, Case, Approvals. Audit, Analytics, Evaluation. |
| **E · Data & demo** | shared | Supabase schema, views, storage buckets. Intercompany email, extended policy corpus, plant table. Demo script, value calculator numbers, slides. |

| Phase | Goal | Done when |
|---|---|---|
| 0 · before Monday | Repo, Supabase project, schema, mock gateway, eml parser, rules engine skeleton, UI shell, BTP hello-world deploy | One mock case runs end to end in the terminal |
| 1 · correctness | Rules engine + eval runner | 7 of 7 oracle cases pass in rules-only mode |
| 2 · agent | Three model calls, tools, retrieval | 7 of 7 still pass in AI mode, explanations cite rules |
| 3 · product | Inbox, Case, Approvals with realtime; audit | Approve a case in the browser and see the mock document number |
| 4 · SAP | Real gateway, one real write on a team invoice, release with ETag | Document visible in Fiori / SAP GUI; a 412 is demonstrated |
| 5 · polish | Analytics, evaluation tab, value calculator, status endpoint, deploy to BTP | Demo runs from the BTP URL in under 8 minutes |

### Known traps

- **Writes need a token handshake.** GET with `x-csrf-token: Fetch`, keep the cookies, send both on the POST. Lives in the gateway.
- **Return items need both the invoice reference and the item number**, otherwise SAP silently makes a normal sale instead of a return.
- **The released credit does not post to accounting on its own** on DS4. Either stop the demo at the released request or call the extra release step.
- **Goods receipt lives in a different API version** with a `;v=0002` suffix. Only matters for step 5.1.3.
- **Numbers and dates arrive as strings**: `"5.000"`, `"/Date(1790640000000)/"`. Parse once, in the gateway client.
- **Gateway responses are JSON inside a string** today. Unwrap in the client; nobody else should know.
- **Gateway has no auth.** Accepted for the hackathon. Say so if asked, and name the one-line fix (shared API key header).
- **Connectivity will fail at some point.** Keep `SAP_MODE=mock` one click away, including on stage.
- **Mock invoices are never written to DS4.** Real writes only against the team's four assigned invoices. Guard this in code: the real client refuses invoice numbers 90000353 to 90000358.
- **The organizer warned of a curve ball.** Most likely one of the above, or new emails on the day. Nothing may be hardcoded to the seven mock inputs.

### Suggested repository layout

```
returns-agent/
  apps/
    web/            React + Vite (screens, realtime, role switch)
    api/            Node + TS backend
      src/intake/     eml parsing, attachment storage
      src/sap/        GatewayClient interface, RealGateway, MockGateway, types
      src/rules/      rules engine (pure), thresholds, intercompany
      src/agent/      extract, investigate (tools), explain, retrieval
      src/approval/   decisions, write-through, release
      src/eval/       oracle runner
      src/status/     Control Tower endpoint
  packages/
    shared/         Zod schemas: Facts, Findings, Decision, Proposal
  gateway/          Alex's CAP project (or a link to its repo)
  mock-data/        the organizers' folder, plus our intercompany email
  infra/            manifest.yml, approuter xs-app.json, deploy script
  docs/             this page, demo script, slides
```
