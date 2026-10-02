# Reclaim · Frontend and shared contract · Design spec

Date: 2 October 2026
Sub-project 1 of the Reclaim hackathon build. Scope: monorepo scaffold, shared schemas, frontend running on a mock API.
Out of scope: backend (`apps/api`), agent, SAP gateway integration, Supabase, BTP deployment. Those are separate sub-projects owned by the team over the weekend and Monday.

Reference: `docs/Returns-Agent-Architecture.md` (functional and technical architecture).

## 1. Goal and success criteria

Reclaim turns a customer complaint email into an approved SAP return (YRE) or credit memo request (YCR). The model reads and explains, code decides about money, a named person approves every SAP change.

This sub-project delivers a demo-ready, enterprise-grade web UI that:

- runs entirely on mock data with no backend, today;
- talks to the real backend later by changing one environment variable, with no UI changes;
- shows the six screens from the architecture: Inbox, Case, Approvals, Audit, Analytics, Evaluation;
- supports the stage demo end to end: seed the eight cases, run all, open case 01, choose between the two options, approve, see the document number, trigger a 412 conflict, show the evaluation at 8 of 8;
- uses Deloitte colours, light and dark themes, desktop-first layout (projector), English UI.

Timeline: frontend on Friday 2 Oct. Backend over the weekend and Monday 5 Oct. Refinement Tuesday 6 Oct morning. Presentation Tuesday 6 Oct at 13:00.

## 2. Monorepo

npm workspaces (the user asked for npm, not pnpm). Node 25 locally; `engines.node >= 20`.

```
reclaim/
  package.json              workspaces: apps/*, packages/*
  apps/
    web/                    React + Vite + TypeScript (this sub-project)
    api/                    placeholder: README describing the contract the backend must implement
  packages/
    shared/                 Zod schemas, derived types, constants
  docs/                     architecture, specs, plans
  mock-data/                the organizers' folder, unchanged, plus our own additions under mock-data/extra/
```

Tooling: TypeScript strict, ESLint (typescript-eslint, react-hooks), Prettier, Vitest. Root scripts: `dev`, `build`, `test`, `lint`, `typecheck`.

Git: initialised in this folder, first commit contains the scaffold, the spec and the architecture docs. `.gitignore` covers node_modules, dist, .env, .DS_Store.

## 3. Shared package (`packages/shared`)

Pure TypeScript, no React. Exports Zod schemas, types inferred from them, and constants. The backend validates its responses against the same schemas.

### 3.1 Enums and constants

- `CaseStatus`: `received`, `investigating`, `proposed`, `awaiting_approval`, `approved`, `written_to_sap`, `closed`, `needs_customer_input`, `handed_over`, `duplicate`, `rejected`, `sap_write_failed`.
- `ComplaintType`: `damaged`, `ruined`, `quality`, `price`, `short_delivery`, `over_quantity`, `replacement`, `follow_up`, `unknown`.
- `RuleId`: `R1` to `R9`, plus `NONE`.
- `DocumentType`: `YRE`, `YCR`, `NONE`.
- `ReasonCode`: `101`, `102`, `103`, `104`, `105`.
- `ApproverRole`: `customer_service_lead`, `credit_manager`, `finance_director`. `Role` for the UI adds `returns_desk`.
- `L4Step`: `5.1.1`, `5.1.2`, `5.1.3`, `5.2.1`, `5.2.2`.
- `AiMode`: `assisted`, `rules_only`. `SapMode`: `mock`, `real`.
- `RULES`: table of the nine rules with situation, decision, document type, reason code and the policy text, from `mock-data/reference/returns-policy.md`.
- `APPROVAL_THRESHOLDS`: up to 500 → customer service lead; 500 to 5 000 → credit manager; above 5 000 → finance director; any R3, R4, R5 → credit manager at least.
- `REASON_CODES`: 101 poor quality, 102 damaged in transit, 103 quantity discrepancy, 104 material ruined, 105 free sample.
- `L4_STEPS`: id, name, who decides.

### 3.2 Schemas

- `Facts` (output of extraction): invoiceNumber (nullable), material, claimedQuantity, unit, complaintType, claimedUnitPrice (nullable), wantsReplacement, goodsReturnable (nullable), evidence (string), language.
- `InvoiceSnapshot`: number, date, customer, salesOrg, distributionChannel, division, companyCode, currency, totalNetAmount, etag, items[] with item, material, description, quantity, unit, netAmount, unitPrice, plant, salesOrder, delivery.
- `Findings`: invoice (InvoiceSnapshot, nullable), candidateInvoices[] (for R9), existingReturns[], existingCredits[], agreedUnitPrice (nullable), plantCompanyCode (nullable), lookups[] (name, args, durationMs, ok).
- `Decision`: ruleId, documentType, reasonCode (nullable), material, quantity, unit, amount, currency, approverRole (nullable), intercompany (boolean), requiresCustomerConfirmation (boolean), notes (string, from code, not the model).
- `Proposal`: id, caseId, option (`A` or `B` or `single`), recommended (boolean), decision, sapPayload (object or null), explanation, policyCitations[] (ruleId, text), replyDraft, briefing (three strings: whatHappened, whatWePropose, risk), createdAt.
- `Approval`: id, proposalId, actor, role, decision (`approved`, `rejected`), editedQuantity (nullable), comment, decidedAt.
- `SapDocument`: id, caseId, type, number, payload, response, createdAt, released (boolean).
- `CaseEvent`: id, caseId, at, l4Step (nullable), kind (`intake`, `lookup`, `rule`, `model`, `proposal`, `approval`, `sap_write`, `sap_release`, `status`, `error`), title, detail (object), durationMs (nullable).
- `Case`: id, receivedAt, from, subject, bodyText, attachments[] (name, mimeType, url), status, customer, invoiceNumber, complaintType, aiMode, facts (nullable), findings (nullable), proposals[], approvals[], sapDocuments[], events[], anomalies[] (strings), createdAt, updatedAt.
- `CaseSummary`: the Inbox row: id, receivedAt, from, subject, customer, invoiceNumber, complaintType, status, ruleId, documentType, amount, currency, approverRole, updatedAt.
- `EvalResult`: caseId, emailFile, fields[] (name, expected, actual, pass), pass.
- `AgentStatus`: name (`Reclaim · Returns & Credit Note`), agentId (`o2c-agent-8`), cases, pending, lastRunAt, sapMode, aiMode.
- `Settings`: sapMode, aiMode, simulateConflict (boolean).
- `AnalyticsSummary`: counts by status and complaint type, approved and rejected value, median hours to approval, proposals accepted unchanged (ratio), duplicates prevented, intercompany flagged, series by week.

### 3.3 API contract

`API_ROUTES` constant lists every route from the architecture with method, path and the response schema, so the backend team has a single source of truth and the HTTP client is built from it.

## 4. API client (`apps/web/src/api`)

One interface, two implementations, selected by `VITE_API_MODE=mock|http`.

```ts
interface ApiClient {
  listCases(): Promise<CaseSummary[]>
  getCase(id): Promise<Case>
  seedCases(): Promise<void>
  ingest(files: File[]): Promise<CaseSummary[]>
  runCase(id): Promise<void>
  runAll(): Promise<void>
  chooseProposal(proposalId): Promise<void>
  approve(proposalId, input: { actor, role, editedQuantity?, comment? }): Promise<ApproveResult>
  reject(proposalId, input: { actor, role, comment }): Promise<void>
  release(sapDocumentId): Promise<ReleaseResult>
  getAnalytics(): Promise<AnalyticsSummary>
  runEval(): Promise<EvalResult[]>
  getLatestEval(): Promise<EvalResult[] | null>
  getStatus(): Promise<AgentStatus>
  getSettings(): Promise<Settings>
  updateSettings(patch): Promise<Settings>
  subscribe(listener: (event: { type: 'case_changed' | 'status_changed', id?: string }) => void): () => void
}
```

`ApproveResult` is `{ ok: true, document: SapDocument } | { ok: false, status: number, message: string }`. A 412 is `{ ok: false, status: 412, message: 'The record changed in SAP since it was read. Nothing was written. Reload the case and approve again.' }`.

### 4.1 MockApiClient

- In-memory state, seeded from fixtures. Optional persistence to `localStorage` under a versioned key so a refresh during the demo keeps the state; a "Reset demo" action clears it.
- `runCase` walks the case through `investigating` → `proposed` → `awaiting_approval` (or a side exit) with delays between 400 and 1200 ms per step, emitting `CaseEvent`s with L4 IDs and `case_changed` notifications after each step. In `rules_only` mode the model events are skipped and the explanation is the template text.
- `approve` waits 600 ms, then: if `simulateConflict` is on, returns the 412 result and emits an `error` event; otherwise creates a `SapDocument` with a number in the 600001xx range, sets status `written_to_sap`, emits `sap_write` with the payload and response.
- `runEval` compares each case's recommended proposal to the expected results and returns the pass matrix.
- `ingest` parses nothing in the mock: it accepts the files and creates cases from their text if they match a fixture name, otherwise creates a case with status `received` and `unknown` type.

### 4.2 HttpApiClient

Thin fetch wrapper built from `API_ROUTES`, validating responses with the shared schemas in development. `subscribe` uses Server-Sent Events on `/api/events` if available, otherwise polls every 3 seconds. Only the signature matters now; the backend team owns the other end.

## 5. Fixtures (`apps/web/src/api/mock/fixtures`)

Built by hand from the organizers' materials so every screen shows real content:

- Eight cases: the seven mock emails plus `08-intercompany.eml`, which we write (sold by YDE1, plant in YRO1, 3 KG damaged, invoice 90000359). Text taken from the `.eml` bodies, the photo copied to `apps/web/public/mock/`.
- Per case: `Facts`, `Findings` (from the captured SAP responses where they exist, consistent invented values otherwise, matching expected-results.json: 90000355 = 20 KG, 90000356 = 8 KG, 90000357 = 15 KG on 29 Sep, 90000358 = 5 KG), `Decision`s, explanation text citing the rule, reply draft, briefing.
- Case 01 has two proposals, A (R1, YRE 102) and B (R3, YCR 104). B is marked recommended, because the email says the material is lost and a photo is attached.
- Case 06 (duplicate) only resolves correctly once case 01 has a document; before that its proposal says "no document yet for 90000353, treating as follow-up".
- Expected results from `mock-data/expected-results.json` reused as the eval oracle, extended with case 08.
- Analytics fixture: 90 days of synthetic history (about 60 closed cases) so the dashboard has series, clearly labelled as demo history.

## 6. Design system

### 6.1 Colour

Deloitte base: black and white, cool greys. Signature green `#86BC25` as the accent for navigation marks, primary buttons, active states and focus rings. Deloitte dark green `#046A38` for hover and for the "approved" status. Deloitte teal `#0097A9` and blue `#00A3E0` for informational elements and the second and third chart series.

Status colours are separate from the accent: approved `#046A38`, pending amber `#B8860B`, refused or failed red `#C0392B`, info teal. Each has a soft background variant for chips.

Tokens defined on `:root` for light, redefined for dark under both `prefers-color-scheme: dark` and `[data-theme="dark"]`. Dark base is near-black `#0B0D0F` with `#15181C` surfaces; the green reads on both.

### 6.2 Type

Open Sans (Google Fonts) for UI and body, JetBrains Mono for document numbers, amounts, IDs and payloads. Type scale: 12, 13, 14 (base), 16, 20, 24, 32. Tabular numerals everywhere digits align.

### 6.3 Components

shadcn/ui primitives (button, badge, card, dialog, sheet, table, tabs, tooltip, dropdown, switch, select, toast, skeleton, separator, scroll-area). Domain components built on them:

- `StatusChip` (status → colour and label), `RuleBadge` (R1 to R9 with tooltip of the rule text), `DocTypeBadge` (YRE, YCR, none).
- `DocFlow`: the chain order → delivery → invoice → return or credit, with numbers.
- `Timeline`: case events with L4 ID, kind icon, duration.
- `PayloadView`: the SAP payload as a readable key/value block with a "raw JSON" toggle and copy.
- `KpiTile`, `EmptyState`, `ErrorState`, `ModeSwitch`, `RoleSwitch`, `AgentStatusBadge`.

### 6.4 Layout

Left navigation rail (64 px collapsed, 220 px expanded) with Inbox, Approvals, Analytics, Evaluation. Top bar with the Reclaim wordmark, the agent status badge (cases, pending, last run), SAP mode switch, AI mode switch, role switch, theme toggle, "Reset demo". Content area max 1440 px. Minimum supported width 1024 px; below that, panels stack.

## 7. Screens

### 7.1 Inbox (`/`)

Table: received, from, subject, customer, invoice, type, rule, proposed action (document type and amount), approver, status, updated. Row click opens the case. Toolbar: "Seed demo cases", "Run all", "Upload .eml", filter by status and type, search. Status chips animate when a case is running. Empty state explains how to seed.

### 7.2 Case (`/cases/:id`)

Header: subject, customer, invoice, status, rule badge, actions (Run, Open in approvals).
Three zones:
1. **Complaint**: sender, date, body, attachments with image preview, the extracted facts as a compact list with "what the model read" wording. Anomaly chips if any.
2. **What we found in SAP**: `DocFlow` strip, invoice card (date, customer, sales area, company code, plant, items with quantity and unit price), existing returns and credits, agreed price vs invoiced price when relevant, candidate invoices for R9, intercompany notice when flagged. Every lookup links to its timeline event.
3. **Proposal**: one card, or two side by side for R1/R3 with the recommended one marked. Each card: rule badge and quoted policy text, decision table (document, reason, material, quantity, amount, approver), `PayloadView`, reply draft, briefing. Actions: "Choose this option" (two-option case), "Send to approval". Side exits (R6 to R9) show the reason and the drafted message to the customer or to customer service instead of a payload.
Tabs below: Timeline (audit), Raw data.

### 7.3 Approvals (`/approvals`)

Left: queue filtered to the current role's threshold, with a toggle to show all. Each row: briefing first line, customer, amount, rule, waiting time. Right panel on selection: full briefing, decision table, payload, reply draft, "Approve", "Reject" (comment required), "Edit quantity" (inline, re-computes amount, cannot exceed invoiced). After approve: success state with the document number and a "Release billing block" button that calls `release`. A failed write shows the status and message in a red panel with "Reload case".

### 7.4 Audit (`/cases/:id/audit`, also a tab in Case)

Vertical timeline grouped by L4 step. Each event expandable to its detail JSON. "Export JSON" copies the full case.

### 7.5 Analytics (`/analytics`)

KPI tiles: cases this month, pending approvals, approved value, median time to approval, proposals accepted unchanged, duplicates prevented, intercompany flagged. Charts (Recharts): cases per week by complaint type (stacked bars), approved vs rejected value per week (bars), outcome mix (horizontal bar). Value calculator section: the formula from the guide with editable inputs and live results.

### 7.6 Evaluation (`/evaluation`)

"Run evaluation" button, last run time. Matrix: one row per case, columns rule, document, reason, quantity, amount, approver, each cell green or red with expected vs actual on hover. Header shows "8 of 8 passing".

## 8. State and data flow

- TanStack Query for all server state, keyed by route. `subscribe` events invalidate the affected queries.
- Zustand store for UI state: role, theme, nav collapsed. Modes live in Settings on the API (so the backend can read them) and are mirrored in the store.
- Router: TanStack Router with typed routes.
- Errors: every query has an `ErrorState` with retry; mutations surface toasts; SAP write failures are rendered inline, never only as a toast.
- Loading: skeletons that match the final layout.

## 9. Testing

- Vitest in `packages/shared`: every fixture validates against its schema; thresholds and rule table behave as the policy says.
- Vitest in `apps/web`: `MockApiClient` run on each of the eight cases yields the expected rule, document type, reason, quantity, amount and approver; the 412 path returns the error shape; the duplicate case depends on case 01 as designed.
- The same expectations are exported as a reusable test so the backend team can run them against `HttpApiClient`.
- One manual smoke script in `docs/demo-script.md`: the exact click sequence for the stage demo.

## 10. Folder layout (`apps/web/src`)

```
app/            router, providers, layout (nav rail, top bar)
api/            ApiClient interface, mock/, http/, hooks (useCases, useCase, ...)
features/
  inbox/  case/  approvals/  audit/  analytics/  evaluation/
components/
  ui/           shadcn
  domain/       StatusChip, RuleBadge, DocFlow, Timeline, PayloadView, KpiTile, ...
store/          zustand ui store
theme/          tokens.css, theme toggle
lib/            format (money, dates, quantities), utils
```

## 11. Decisions recorded

- npm workspaces, not pnpm (user preference).
- In-browser mock client rather than a stub server: faster UI iteration; the shared package carries the contract for the backend team.
- Case 01 recommends option B (credit only, R3) by default; the person can choose A.
- The frontend never talks to Supabase directly in this sub-project. Live updates come through `ApiClient.subscribe`, so a Supabase realtime implementation can be added behind the same method later.
- Status and accent greens are different shades on purpose so "approved" and "primary action" never look the same.
