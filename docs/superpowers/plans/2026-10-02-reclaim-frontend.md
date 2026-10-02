# Reclaim Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Reclaim monorepo, the shared contract package and a demo-ready React frontend that runs on an in-browser mock of the backend and can switch to the real backend by one environment variable.

**Architecture:** npm workspaces with `packages/shared` (Zod schemas, constants, route table) consumed by `apps/web` (React + Vite). The web app talks to one `ApiClient` interface with two implementations: `MockApiClient` (in-memory, simulated pipeline, fixtures from the organizers' mock data) and `HttpApiClient` (fetch wrapper built from the shared route table). Screens are feature folders that only use TanStack Query hooks over the client.

**Tech Stack:** Node 25 / npm 11 workspaces, TypeScript 5 strict, Zod 4, Vitest 3, React 18, Vite 7, Tailwind 4, shadcn/ui, TanStack Router 1 (code-based routes), TanStack Query 5, Zustand 5, Recharts 3, lucide-react, sonner (toasts).

**Spec:** `docs/superpowers/specs/2026-10-02-reclaim-frontend-design.md`

## Global Constraints

- Package manager is npm (workspaces). Never pnpm or yarn.
- `engines.node >= 20`. TypeScript `strict: true` everywhere.
- Product name is "Reclaim". Agent id `o2c-agent-8`, agent name `Reclaim · Returns & Credit Note`.
- Colours: accent `#86BC25`, dark green `#046A38`, teal `#0097A9`, blue `#00A3E0`; status approved `#046A38`, pending `#B8860B`, failed `#C0392B`. Light and dark themes via tokens on `:root`, `prefers-color-scheme: dark` guarded by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`.
- Fonts: Open Sans (UI), JetBrains Mono (numbers, IDs, payloads). Tabular numerals wherever digits align.
- Desktop-first, minimum width 1024 px, content max 1440 px. English UI.
- Quantity can never exceed the invoiced quantity; amount can never exceed the invoice line amount. Enforced in shared helpers and in the mock, never only in the UI.
- Case 01 has two proposals (A = R1/YRE/102, B = R3/YCR/104); B is recommended.
- Mock invoices 90000353 to 90000359 are demo data; no code path may send them to a real SAP.
- Every SAP write failure is rendered inline in the Approvals panel, never only as a toast.
- Commit after every task with a conventional message and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Approving a case while another approve is in flight.** Expected: the second click is ignored (button disabled while pending), no duplicate SAP document. Test added in Task 6 (`approve twice concurrently creates one document`).
2. **Editing the quantity above the invoiced quantity in Approvals.** Expected: the input clamps, shows a message, and the approve button stays disabled until valid. Test added in Task 2 (`capQuantity`) and Task 11 (component test on `QuantityEditor`).
3. **Running case 06 before case 01 has a document.** Expected: case 06 still ends as `duplicate` (R8), because case 01 is an open case on the same invoice in our own system; the note names `case-01` instead of a SAP document number. Test added in Task 6.
4. **Page refresh mid-demo.** Expected: mock state restored from localStorage, including a case in `investigating` (restored as `received` so it can be re-run, never stuck). Test added in Task 6 (`restore resets transient statuses`).
5. **An `.eml` upload that matches none of the fixtures.** Expected: a case in `received` with type `unknown`, subject from the file, run produces `NONE` rule with `needs_customer_input`. Test added in Task 6.

---

## File structure

```
package.json                         npm workspaces, root scripts
tsconfig.base.json                   shared compiler options
.eslintrc.cjs, .prettierrc           lint and format
apps/api/README.md                   contract for the backend team
packages/shared/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                       re-exports
  src/enums.ts                       CaseStatus, ComplaintType, RuleId, DocumentType, ReasonCode, roles, L4Step, modes
  src/policy.ts                      RULES, REASON_CODES, APPROVAL_THRESHOLDS, L4_STEPS, approverFor, capQuantity
  src/schemas.ts                     Zod schemas and inferred types
  src/routes.ts                      API_ROUTES
  src/__tests__/policy.test.ts, schemas.test.ts
apps/web/
  package.json, vite.config.ts, tsconfig.json, index.html, components.json
  src/main.tsx                       providers + router
  src/app/router.tsx                 routes
  src/app/layout/AppShell.tsx, NavRail.tsx, TopBar.tsx
  src/theme/tokens.css               colour, type tokens, light/dark
  src/store/ui.ts                    zustand: role, theme, navCollapsed
  src/lib/format.ts                  money, qty, dates, relative time
  src/api/client.ts                  ApiClient interface + result types
  src/api/context.tsx                ApiProvider, useApi
  src/api/hooks.ts                   TanStack Query hooks
  src/api/http/HttpApiClient.ts
  src/api/mock/MockApiClient.ts      state, persistence, subscribe, settings, status
  src/api/mock/pipeline.ts           runCase state machine
  src/api/mock/fixtures/cases.ts     eight cases
  src/api/mock/fixtures/expected.ts  eval oracle
  src/api/mock/fixtures/history.ts   analytics history
  src/api/mock/__tests__/pipeline.test.ts
  src/components/ui/*                shadcn
  src/components/domain/*            StatusChip, RuleBadge, DocTypeBadge, DocFlow, Timeline, PayloadView, KpiTile, EmptyState, ErrorState
  src/features/inbox/InboxPage.tsx
  src/features/case/CasePage.tsx, ComplaintPanel.tsx, SapFindingsPanel.tsx, ProposalCard.tsx
  src/features/approvals/ApprovalsPage.tsx, ApprovalPanel.tsx, QuantityEditor.tsx
  src/features/audit/AuditTimeline.tsx
  src/features/analytics/AnalyticsPage.tsx, ValueCalculator.tsx
  src/features/evaluation/EvaluationPage.tsx
docs/demo-script.md
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.prettierrc`, `.eslintrc.cjs`, `apps/api/README.md`, `apps/api/package.json`

**Interfaces:**
- Produces: root scripts `npm run typecheck`, `npm run test`, `npm run lint`, `npm run build`, `npm run dev` that fan out to workspaces.

- [ ] **Step 1: Root package.json**

```json
{
  "name": "reclaim",
  "private": true,
  "version": "0.1.0",
  "engines": { "node": ">=20" },
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm run dev --workspace apps/web",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^8.57.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "prettier": "^3.3.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Lint and format config**

`.prettierrc`: `{ "semi": false, "singleQuote": true, "printWidth": 100 }`

`.eslintrc.cjs`:
```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
  ignorePatterns: ['dist', 'node_modules', '*.cjs'],
  rules: { '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
}
```

- [ ] **Step 4: apps/api placeholder**

`apps/api/package.json`: `{ "name": "@reclaim/api", "private": true, "version": "0.1.0", "scripts": {} }`

`apps/api/README.md`:
```md
# Reclaim backend (to be built)

Implement the routes in `packages/shared/src/routes.ts` and validate every response with the schemas in `packages/shared/src/schemas.ts`. The frontend's `HttpApiClient` (apps/web/src/api/http) is the consumer. Run the frontend with `VITE_API_MODE=http VITE_API_BASE=http://localhost:3000` to test against it. The mock client in `apps/web/src/api/mock` shows the expected behaviour of every route, including delays, events and the 412 path. The test in `apps/web/src/api/mock/__tests__/pipeline.test.ts` is the acceptance test: the real backend must produce the same decisions for the eight demo cases.
```

- [ ] **Step 5: Install and verify**

Run: `npm install && npm run typecheck && npm run lint`
Expected: both succeed with no workspaces yet having scripts (no output is fine).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .prettierrc .eslintrc.cjs apps/api
git commit -m "chore: npm workspaces scaffold and api placeholder"
```

---

### Task 2: Shared package: enums, policy, schemas, routes

**Files:**
- Create: `packages/shared/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/enums.ts`, `src/policy.ts`, `src/schemas.ts`, `src/routes.ts`
- Test: `packages/shared/src/__tests__/policy.test.ts`, `schemas.test.ts`

**Interfaces:**
- Produces: `approverFor(amount: number, ruleId: RuleId): ApproverRole`, `capQuantity(claimed: number, invoiced: number): number`, `RULES: Record<RuleId, RuleDef>`, all schemas and types listed in spec §3, `API_ROUTES`.

- [ ] **Step 1: package files**

`packages/shared/package.json`:
```json
{
  "name": "@reclaim/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^4.0.0" },
  "devDependencies": { "vitest": "^3.0.0" }
}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`
`vitest.config.ts`: `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { environment: 'node' } })`

- [ ] **Step 2: Write failing policy tests**

```ts
// packages/shared/src/__tests__/policy.test.ts
import { describe, it, expect } from 'vitest'
import { approverFor, capQuantity, RULES, APPROVAL_THRESHOLDS } from '../policy'

describe('approverFor', () => {
  it('routes by value', () => {
    expect(approverFor(300, 'R1')).toBe('customer_service_lead')
    expect(approverFor(540, 'R1')).toBe('credit_manager')
    expect(approverFor(6000, 'R1')).toBe('finance_director')
  })
  it('credit without goods goes to credit manager at least', () => {
    expect(approverFor(120, 'R4')).toBe('credit_manager')
    expect(approverFor(120, 'R5')).toBe('credit_manager')
    expect(approverFor(120, 'R3')).toBe('credit_manager')
    expect(approverFor(6000, 'R3')).toBe('finance_director')
  })
})
describe('capQuantity', () => {
  it('never exceeds invoiced', () => {
    expect(capQuantity(10, 8)).toBe(8)
    expect(capQuantity(2, 5)).toBe(2)
    expect(capQuantity(-1, 5)).toBe(0)
  })
})
describe('RULES', () => {
  it('has nine rules with document and reason', () => {
    expect(Object.keys(RULES)).toHaveLength(10) // R1..R9 + NONE
    expect(RULES.R1.documentType).toBe('YRE'); expect(RULES.R1.reasonCode).toBe('102')
    expect(RULES.R5.documentType).toBe('YCR'); expect(RULES.R5.reasonCode).toBe('103')
    expect(RULES.R7.documentType).toBe('NONE')
  })
  it('thresholds are ordered', () => {
    expect(APPROVAL_THRESHOLDS.map((t) => t.upTo)).toEqual([500, 5000, Infinity])
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test --workspace packages/shared`  Expected: FAIL, modules not found.

- [ ] **Step 4: enums.ts**

```ts
export const CASE_STATUSES = ['received','investigating','proposed','awaiting_approval','approved','written_to_sap','closed','needs_customer_input','handed_over','duplicate','rejected','sap_write_failed'] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]
export const COMPLAINT_TYPES = ['damaged','ruined','quality','price','short_delivery','over_quantity','replacement','follow_up','unknown'] as const
export type ComplaintType = (typeof COMPLAINT_TYPES)[number]
export const RULE_IDS = ['R1','R2','R3','R4','R5','R6','R7','R8','R9','NONE'] as const
export type RuleId = (typeof RULE_IDS)[number]
export const DOCUMENT_TYPES = ['YRE','YCR','NONE'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export const REASON_CODE_IDS = ['101','102','103','104','105'] as const
export type ReasonCode = (typeof REASON_CODE_IDS)[number]
export const APPROVER_ROLES = ['customer_service_lead','credit_manager','finance_director'] as const
export type ApproverRole = (typeof APPROVER_ROLES)[number]
export const ROLES = [...APPROVER_ROLES, 'returns_desk'] as const
export type Role = (typeof ROLES)[number]
export const L4_STEP_IDS = ['5.1.1','5.1.2','5.1.3','5.2.1','5.2.2'] as const
export type L4Step = (typeof L4_STEP_IDS)[number]
export const AI_MODES = ['assisted','rules_only'] as const
export type AiMode = (typeof AI_MODES)[number]
export const SAP_MODES = ['mock','real'] as const
export type SapMode = (typeof SAP_MODES)[number]
export const EVENT_KINDS = ['intake','lookup','rule','model','proposal','approval','sap_write','sap_release','status','error'] as const
export type EventKind = (typeof EVENT_KINDS)[number]
export const ROLE_LABELS: Record<Role, string> = { customer_service_lead: 'Customer service lead', credit_manager: 'Credit manager', finance_director: 'Finance director', returns_desk: 'Returns desk' }
export const STATUS_LABELS: Record<CaseStatus, string> = { received: 'Received', investigating: 'Investigating', proposed: 'Proposed', awaiting_approval: 'Awaiting approval', approved: 'Approved', written_to_sap: 'Written to SAP', closed: 'Closed', needs_customer_input: 'Needs customer input', handed_over: 'Handed over', duplicate: 'Duplicate', rejected: 'Rejected', sap_write_failed: 'SAP write failed' }
export const COMPLAINT_LABELS: Record<ComplaintType, string> = { damaged: 'Damaged in transit', ruined: 'Goods ruined', quality: 'Poor quality', price: 'Price difference', short_delivery: 'Short delivery', over_quantity: 'Over quantity', replacement: 'Replacement request', follow_up: 'Follow-up', unknown: 'Unclassified' }
```

- [ ] **Step 5: policy.ts**

```ts
import type { ApproverRole, DocumentType, L4Step, ReasonCode, RuleId } from './enums'
export interface RuleDef { id: RuleId; situation: string; decision: string; documentType: DocumentType; reasonCode: ReasonCode | null; policyText: string }
export const RULES: Record<RuleId, RuleDef> = {
  R1: { id: 'R1', situation: 'Goods damaged in transit, customer can return them', decision: 'Return the damaged quantity; credit after the goods are received', documentType: 'YRE', reasonCode: '102', policyText: 'R1 — Goods damaged in transit, customer can return them: return the damaged quantity; credit after the goods are received. Customer return (YRE), order reason 102.' },
  R2: { id: 'R2', situation: 'Poor quality / defective, customer can return them', decision: 'Return; credit after receipt', documentType: 'YRE', reasonCode: '101', policyText: 'R2 — Poor quality or defective, customer can return them: return; credit after receipt. Customer return (YRE), order reason 101.' },
  R3: { id: 'R3', situation: 'Goods ruined, cannot be returned (leaked, contaminated, destroyed)', decision: 'Credit only, with photo evidence', documentType: 'YCR', reasonCode: '104', policyText: 'R3 — Goods ruined, cannot be returned (leaked, contaminated, destroyed): credit only, with photo evidence. Credit memo request (YCR), order reason 104.' },
  R4: { id: 'R4', situation: 'Price higher than agreed', decision: 'Credit the difference only, after checking the agreed price (PR00)', documentType: 'YCR', reasonCode: '101', policyText: 'R4 — Price higher than agreed: credit the difference only, after checking the agreed price (PR00). If the invoiced price equals the agreed price there is no credit; the agent drafts a reply that shows the agreed price.' },
  R5: { id: 'R5', situation: 'Short delivery (less arrived than invoiced)', decision: 'Credit the missing quantity; ask the warehouse to check proof of delivery', documentType: 'YCR', reasonCode: '103', policyText: 'R5 — Short delivery (less arrived than invoiced): credit the missing quantity; ask the warehouse to check proof of delivery. Credit memo request (YCR), order reason 103.' },
  R6: { id: 'R6', situation: 'Customer asks for a replacement', decision: 'Do not create a credit; hand over to customer service for a free re-delivery', documentType: 'NONE', reasonCode: null, policyText: 'R6 — Customer asks for a replacement: do not create a credit; hand over to customer service for a free re-delivery.' },
  R7: { id: 'R7', situation: 'Claimed quantity or amount exceeds the invoice', decision: 'Refuse; ask the customer to correct', documentType: 'NONE', reasonCode: null, policyText: 'R7 — Claimed quantity or amount exceeds the invoice: refuse; ask the customer to correct.' },
  R8: { id: 'R8', situation: 'Same complaint already handled', decision: 'Do not create a second document; answer with the existing number', documentType: 'NONE', reasonCode: null, policyText: 'R8 — Same complaint already handled (a return or credit exists for the invoice): do not create a second document; answer with the existing number.' },
  R9: { id: 'R9', situation: 'Invoice not named', decision: 'Search the customer’s invoices for material and date; propose the match; ask the customer to confirm', documentType: 'NONE', reasonCode: null, policyText: 'R9 — Invoice not named: search the customer’s invoices for material and date; propose the match; ask the customer to confirm. No document until confirmed.' },
  NONE: { id: 'NONE', situation: 'No rule applies', decision: 'Ask a person to decide and consider extending the policy', documentType: 'NONE', reasonCode: null, policyText: 'No rule in the returns policy matches this complaint.' },
}
export const REASON_CODES: Record<ReasonCode, string> = { '101': 'Poor quality', '102': 'Damaged in transit', '103': 'Quantity discrepancy', '104': 'Material ruined', '105': 'Free-of-charge sample' }
export const APPROVAL_THRESHOLDS: { upTo: number; role: ApproverRole }[] = [ { upTo: 500, role: 'customer_service_lead' }, { upTo: 5000, role: 'credit_manager' }, { upTo: Infinity, role: 'finance_director' } ]
export const NO_GOODS_BACK_RULES: RuleId[] = ['R3', 'R4', 'R5']
const ROLE_RANK: Record<ApproverRole, number> = { customer_service_lead: 0, credit_manager: 1, finance_director: 2 }
export function approverFor(amount: number, ruleId: RuleId): ApproverRole {
  const byValue = APPROVAL_THRESHOLDS.find((t) => amount <= t.upTo)!.role
  if (NO_GOODS_BACK_RULES.includes(ruleId) && ROLE_RANK[byValue] < ROLE_RANK.credit_manager) return 'credit_manager'
  return byValue
}
export function capQuantity(claimed: number, invoiced: number): number { return Math.max(0, Math.min(claimed, invoiced)) }
export const L4_STEPS: Record<L4Step, { name: string; decides: string }> = { '5.1.1': { name: 'Check whether a return is needed', decides: 'Agent proposes; person approves' }, '5.1.2': { name: 'Create the return order (YRE)', decides: 'Returns desk' }, '5.1.3': { name: 'Release the return and confirm goods received', decides: 'Warehouse' }, '5.2.1': { name: 'Create the credit memo request (YCR)', decides: 'Credit approver' }, '5.2.2': { name: 'Flag the intercompany credit', decides: 'Billing / finance' } }
export const BILLING_BLOCK = '08'
export const DEMO_INVOICES = ['90000353','90000354','90000355','90000356','90000357','90000358','90000359']
```

- [ ] **Step 6: schemas.ts**

```ts
import { z } from 'zod'
import { AI_MODES, APPROVER_ROLES, CASE_STATUSES, COMPLAINT_TYPES, DOCUMENT_TYPES, EVENT_KINDS, L4_STEP_IDS, REASON_CODE_IDS, ROLES, RULE_IDS, SAP_MODES } from './enums'
export const FactsSchema = z.object({ invoiceNumber: z.string().nullable(), material: z.string().nullable(), claimedQuantity: z.number().nullable(), unit: z.string().nullable(), complaintType: z.enum(COMPLAINT_TYPES), claimedUnitPrice: z.number().nullable(), wantsReplacement: z.boolean(), goodsReturnable: z.boolean().nullable(), evidence: z.string(), language: z.string() })
export const InvoiceItemSchema = z.object({ item: z.string(), material: z.string(), description: z.string(), quantity: z.number(), unit: z.string(), netAmount: z.number(), unitPrice: z.number(), plant: z.string(), salesOrder: z.string(), delivery: z.string() })
export const InvoiceSnapshotSchema = z.object({ number: z.string(), date: z.string(), customer: z.string(), customerName: z.string(), salesOrg: z.string(), distributionChannel: z.string(), division: z.string(), companyCode: z.string(), currency: z.string(), totalNetAmount: z.number(), etag: z.string(), items: z.array(InvoiceItemSchema) })
export const ExistingDocSchema = z.object({ type: z.enum(['YRE','YCR']), number: z.string(), reasonCode: z.string(), amount: z.number(), billingBlock: z.string() })
export const LookupSchema = z.object({ name: z.string(), args: z.record(z.string(), z.unknown()), durationMs: z.number(), ok: z.boolean() })
export const FindingsSchema = z.object({ invoice: InvoiceSnapshotSchema.nullable(), candidateInvoices: z.array(InvoiceSnapshotSchema), existingReturns: z.array(ExistingDocSchema), existingCredits: z.array(ExistingDocSchema), agreedUnitPrice: z.number().nullable(), plantCompanyCode: z.string().nullable(), lookups: z.array(LookupSchema) })
export const DecisionSchema = z.object({ ruleId: z.enum(RULE_IDS), documentType: z.enum(DOCUMENT_TYPES), reasonCode: z.enum(REASON_CODE_IDS).nullable(), material: z.string().nullable(), quantity: z.number(), unit: z.string().nullable(), amount: z.number(), currency: z.string(), approverRole: z.enum(APPROVER_ROLES).nullable(), intercompany: z.boolean(), requiresCustomerConfirmation: z.boolean(), notes: z.string() })
export const BriefingSchema = z.object({ whatHappened: z.string(), whatWePropose: z.string(), risk: z.string() })
export const ProposalSchema = z.object({ id: z.string(), caseId: z.string(), option: z.enum(['A','B','single']), recommended: z.boolean(), chosen: z.boolean(), decision: DecisionSchema, sapPayload: z.record(z.string(), z.unknown()).nullable(), explanation: z.string(), policyCitations: z.array(z.object({ ruleId: z.enum(RULE_IDS), text: z.string() })), replyDraft: z.string(), briefing: BriefingSchema, createdAt: z.string() })
export const ApprovalSchema = z.object({ id: z.string(), proposalId: z.string(), actor: z.string(), role: z.enum(ROLES), decision: z.enum(['approved','rejected']), editedQuantity: z.number().nullable(), comment: z.string(), decidedAt: z.string() })
export const SapDocumentSchema = z.object({ id: z.string(), caseId: z.string(), type: z.enum(['YRE','YCR']), number: z.string(), payload: z.record(z.string(), z.unknown()), response: z.record(z.string(), z.unknown()), createdAt: z.string(), released: z.boolean() })
export const CaseEventSchema = z.object({ id: z.string(), caseId: z.string(), at: z.string(), l4Step: z.enum(L4_STEP_IDS).nullable(), kind: z.enum(EVENT_KINDS), title: z.string(), detail: z.record(z.string(), z.unknown()), durationMs: z.number().nullable() })
export const AttachmentSchema = z.object({ name: z.string(), mimeType: z.string(), url: z.string() })
export const CaseSchema = z.object({ id: z.string(), emailFile: z.string().nullable(), receivedAt: z.string(), from: z.string(), subject: z.string(), bodyText: z.string(), attachments: z.array(AttachmentSchema), status: z.enum(CASE_STATUSES), customer: z.string().nullable(), customerName: z.string().nullable(), invoiceNumber: z.string().nullable(), complaintType: z.enum(COMPLAINT_TYPES), aiMode: z.enum(AI_MODES), facts: FactsSchema.nullable(), findings: FindingsSchema.nullable(), proposals: z.array(ProposalSchema), approvals: z.array(ApprovalSchema), sapDocuments: z.array(SapDocumentSchema), events: z.array(CaseEventSchema), anomalies: z.array(z.string()), createdAt: z.string(), updatedAt: z.string() })
export const CaseSummarySchema = z.object({ id: z.string(), receivedAt: z.string(), from: z.string(), subject: z.string(), customer: z.string().nullable(), customerName: z.string().nullable(), invoiceNumber: z.string().nullable(), complaintType: z.enum(COMPLAINT_TYPES), status: z.enum(CASE_STATUSES), ruleId: z.enum(RULE_IDS).nullable(), documentType: z.enum(DOCUMENT_TYPES).nullable(), amount: z.number().nullable(), currency: z.string(), approverRole: z.enum(APPROVER_ROLES).nullable(), updatedAt: z.string() })
export const EvalFieldSchema = z.object({ name: z.string(), expected: z.string(), actual: z.string(), pass: z.boolean() })
export const EvalResultSchema = z.object({ caseId: z.string(), emailFile: z.string(), fields: z.array(EvalFieldSchema), pass: z.boolean() })
export const AgentStatusSchema = z.object({ name: z.string(), agentId: z.string(), cases: z.number(), pending: z.number(), lastRunAt: z.string().nullable(), sapMode: z.enum(SAP_MODES), aiMode: z.enum(AI_MODES) })
export const SettingsSchema = z.object({ sapMode: z.enum(SAP_MODES), aiMode: z.enum(AI_MODES), simulateConflict: z.boolean() })
export const WeekPointSchema = z.object({ week: z.string(), damaged: z.number(), ruined: z.number(), quality: z.number(), price: z.number(), short_delivery: z.number(), other: z.number(), approvedValue: z.number(), rejectedValue: z.number() })
export const AnalyticsSummarySchema = z.object({ casesThisMonth: z.number(), pendingApprovals: z.number(), approvedValue: z.number(), rejectedValue: z.number(), medianHoursToApproval: z.number(), acceptedUnchangedRatio: z.number(), duplicatesPrevented: z.number(), intercompanyFlagged: z.number(), byStatus: z.record(z.string(), z.number()), byType: z.record(z.string(), z.number()), weeks: z.array(WeekPointSchema), currency: z.string() })
export type Facts = z.infer<typeof FactsSchema>; export type InvoiceItem = z.infer<typeof InvoiceItemSchema>; export type InvoiceSnapshot = z.infer<typeof InvoiceSnapshotSchema>; export type ExistingDoc = z.infer<typeof ExistingDocSchema>; export type Findings = z.infer<typeof FindingsSchema>; export type Decision = z.infer<typeof DecisionSchema>; export type Briefing = z.infer<typeof BriefingSchema>; export type Proposal = z.infer<typeof ProposalSchema>; export type Approval = z.infer<typeof ApprovalSchema>; export type SapDocument = z.infer<typeof SapDocumentSchema>; export type CaseEvent = z.infer<typeof CaseEventSchema>; export type Attachment = z.infer<typeof AttachmentSchema>; export type Case = z.infer<typeof CaseSchema>; export type CaseSummary = z.infer<typeof CaseSummarySchema>; export type EvalResult = z.infer<typeof EvalResultSchema>; export type EvalField = z.infer<typeof EvalFieldSchema>; export type AgentStatus = z.infer<typeof AgentStatusSchema>; export type Settings = z.infer<typeof SettingsSchema>; export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>; export type WeekPoint = z.infer<typeof WeekPointSchema>
export function toSummary(c: Case): CaseSummary { const p = c.proposals.find((x) => x.chosen) ?? c.proposals.find((x) => x.recommended) ?? c.proposals[0]; return { id: c.id, receivedAt: c.receivedAt, from: c.from, subject: c.subject, customer: c.customer, customerName: c.customerName, invoiceNumber: c.invoiceNumber, complaintType: c.complaintType, status: c.status, ruleId: p?.decision.ruleId ?? null, documentType: p?.decision.documentType ?? null, amount: p ? p.decision.amount : null, currency: p?.decision.currency ?? 'EUR', approverRole: p?.decision.approverRole ?? null, updatedAt: c.updatedAt } }
```

- [ ] **Step 7: routes.ts and index.ts**

```ts
// routes.ts
export const API_ROUTES = {
  listCases: { method: 'GET', path: '/api/cases' }, getCase: { method: 'GET', path: '/api/cases/:id' }, seedCases: { method: 'POST', path: '/api/cases/seed' }, ingest: { method: 'POST', path: '/api/cases/ingest' }, runCase: { method: 'POST', path: '/api/cases/:id/run' }, runAll: { method: 'POST', path: '/api/cases/run-all' }, chooseProposal: { method: 'POST', path: '/api/proposals/:id/choose' }, approve: { method: 'POST', path: '/api/proposals/:id/approve' }, reject: { method: 'POST', path: '/api/proposals/:id/reject' }, release: { method: 'POST', path: '/api/sap/:id/release' }, analytics: { method: 'GET', path: '/api/analytics/summary' }, runEval: { method: 'POST', path: '/api/eval/run' }, latestEval: { method: 'GET', path: '/api/eval/latest' }, status: { method: 'GET', path: '/api/status' }, getSettings: { method: 'GET', path: '/api/settings' }, updateSettings: { method: 'PUT', path: '/api/settings' }, events: { method: 'GET', path: '/api/events' }, reset: { method: 'POST', path: '/api/demo/reset' },
} as const
export type RouteKey = keyof typeof API_ROUTES
// index.ts
export * from './enums'; export * from './policy'; export * from './schemas'; export * from './routes'
```

- [ ] **Step 8: Schema test**

```ts
// packages/shared/src/__tests__/schemas.test.ts
import { describe, it, expect } from 'vitest'
import { DecisionSchema, SettingsSchema } from '../schemas'
describe('schemas', () => {
  it('parses a decision', () => { expect(DecisionSchema.parse({ ruleId: 'R5', documentType: 'YCR', reasonCode: '103', material: '54', quantity: 2, unit: 'KG', amount: 540, currency: 'EUR', approverRole: 'credit_manager', intercompany: false, requiresCustomerConfirmation: false, notes: '' }).amount).toBe(540) })
  it('rejects unknown status', () => { expect(() => SettingsSchema.parse({ sapMode: 'live', aiMode: 'assisted', simulateConflict: false })).toThrow() })
})
```

- [ ] **Step 9: Run tests and typecheck**

Run: `npm install && npm test --workspace packages/shared && npm run typecheck --workspace packages/shared`  Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/shared package-lock.json
git commit -m "feat(shared): enums, policy table, schemas and route contract"
```

---

### Task 3: Web app scaffold, theme tokens, UI store

**Files:**
- Create: `apps/web/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `components.json`, `src/main.tsx`, `src/theme/tokens.css`, `src/index.css`, `src/store/ui.ts`, `src/lib/format.ts`, `src/lib/utils.ts`
- Test: `apps/web/src/lib/__tests__/format.test.ts`, `apps/web/src/store/__tests__/ui.test.ts`

**Interfaces:**
- Produces: `useUi()` zustand store `{ role: Role, theme: 'light'|'dark'|'system', navCollapsed: boolean, setRole, setTheme, toggleNav }`; `formatMoney(n, currency)`, `formatQty(n, unit)`, `formatDate(iso)`, `formatRelative(iso)`; CSS tokens `--bg --surface --surface-2 --fg --muted --line --accent --accent-fg --accent-soft --green --teal --blue --ok --ok-soft --warn --warn-soft --bad --bad-soft --info --info-soft`.

- [ ] **Step 1: Scaffold with Vite**

Run from repo root:
```bash
npm create vite@latest apps/web -- --template react-ts
cd apps/web && npm pkg set name="@reclaim/web"
npm install @reclaim/shared@* @tanstack/react-query@^5 @tanstack/react-router@^1 zustand@^5 zod@^4 recharts@^3 lucide-react sonner class-variance-authority clsx tailwind-merge
npm install -D tailwindcss@^4 @tailwindcss/vite@^4 vitest@^3 @testing-library/react @testing-library/jest-dom jsdom @types/node
```
Add scripts to `apps/web/package.json`: `"dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview", "test": "vitest run", "typecheck": "tsc --noEmit -p tsconfig.app.json"`.

- [ ] **Step 2: vite.config.ts and tsconfig paths**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
})
```
In `tsconfig.app.json` add `"baseUrl": ".", "paths": { "@/*": ["src/*"] }` and extend `../../tsconfig.base.json`. In `tsconfig.json` keep the references. `src/test-setup.ts`: `import '@testing-library/jest-dom/vitest'`.

- [ ] **Step 3: shadcn init**

Run: `npx shadcn@latest init -d` (defaults: Tailwind v4, CSS variables, `@/components`, `@/lib/utils`). Then `npx shadcn@latest add button badge card dialog sheet table tabs tooltip dropdown-menu switch select separator scroll-area skeleton input textarea label`. Confirm `src/lib/utils.ts` exports `cn`.

- [ ] **Step 4: index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" />
    <title>Reclaim</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 5: tokens.css**

```css
/* Layout: nav rail + top bar + content column max 1440px. Deloitte base: black/white/cool grey, signature green accent. */
:root {
  --font-sans: 'Open Sans', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
  --bg: #F4F5F7; --surface: #FFFFFF; --surface-2: #ECEEF1; --fg: #121417; --muted: #5F6873; --line: #D8DCE2;
  --accent: #86BC25; --accent-fg: #0B1A00; --accent-soft: #EEF6DF; --green: #046A38; --teal: #0097A9; --blue: #00A3E0;
  --ok: #046A38; --ok-soft: #DFF0E6; --warn: #B8860B; --warn-soft: #FBF1D6; --bad: #C0392B; --bad-soft: #F9E1DD; --info: #0097A9; --info-soft: #DCF2F5;
  --radius: 6px;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0B0D0F; --surface: #15181C; --surface-2: #1D2126; --fg: #E8EAED; --muted: #9AA3AD; --line: #2A3036;
  --accent: #9CD03A; --accent-fg: #0B1A00; --accent-soft: #1F2A12; --green: #5FBF8A; --teal: #3FB9C8; --blue: #4FC0EE;
  --ok: #5FBF8A; --ok-soft: #14301F; --warn: #E0B23C; --warn-soft: #3A2E10; --bad: #EA8373; --bad-soft: #3D1C17; --info: #3FB9C8; --info-soft: #0F2E33;
  color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #0B0D0F; --surface: #15181C; --surface-2: #1D2126; --fg: #E8EAED; --muted: #9AA3AD; --line: #2A3036;
  --accent: #9CD03A; --accent-fg: #0B1A00; --accent-soft: #1F2A12; --green: #5FBF8A; --teal: #3FB9C8; --blue: #4FC0EE;
  --ok: #5FBF8A; --ok-soft: #14301F; --warn: #E0B23C; --warn-soft: #3A2E10; --bad: #EA8373; --bad-soft: #3D1C17; --info: #3FB9C8; --info-soft: #0F2E33;
  color-scheme: dark;
}
@theme inline {
  --color-bg: var(--bg); --color-surface: var(--surface); --color-surface-2: var(--surface-2); --color-fg: var(--fg); --color-muted: var(--muted); --color-line: var(--line);
  --color-accent: var(--accent); --color-accent-fg: var(--accent-fg); --color-accent-soft: var(--accent-soft); --color-green: var(--green); --color-teal: var(--teal); --color-blue: var(--blue);
  --color-ok: var(--ok); --color-ok-soft: var(--ok-soft); --color-warn: var(--warn); --color-warn-soft: var(--warn-soft); --color-bad: var(--bad); --color-bad-soft: var(--bad-soft); --color-info: var(--info); --color-info-soft: var(--info-soft);
  --font-sans: var(--font-sans); --font-mono: var(--font-mono);
}
body { background: var(--bg); color: var(--fg); font-family: var(--font-sans); font-size: 14px; line-height: 1.5; margin: 0; }
.tnum { font-variant-numeric: tabular-nums; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```
`src/index.css`: `@import "tailwindcss"; @import "./theme/tokens.css";` followed by whatever shadcn generated (keep shadcn's `@layer base` but map its `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--border`, `--muted`, `--card`, `--destructive` to the tokens above so shadcn components follow the theme: e.g. `--primary: var(--accent); --primary-foreground: var(--accent-fg); --background: var(--bg); --foreground: var(--fg); --card: var(--surface); --border: var(--line); --muted: var(--surface-2); --muted-foreground: var(--muted); --destructive: var(--bad);`).

- [ ] **Step 6: Failing tests for store and format**

```ts
// src/store/__tests__/ui.test.ts
import { describe, it, expect } from 'vitest'
import { useUi } from '../ui'
describe('ui store', () => {
  it('defaults to credit manager and system theme', () => { const s = useUi.getState(); expect(s.role).toBe('credit_manager'); expect(s.theme).toBe('system') })
  it('applies data-theme on setTheme', () => { useUi.getState().setTheme('dark'); expect(document.documentElement.dataset.theme).toBe('dark'); useUi.getState().setTheme('system'); expect(document.documentElement.dataset.theme).toBeUndefined() })
})
// src/lib/__tests__/format.test.ts
import { describe, it, expect } from 'vitest'
import { formatMoney, formatQty, formatDate } from '../format'
describe('format', () => {
  it('money', () => { expect(formatMoney(540, 'EUR')).toBe('540.00 EUR'); expect(formatMoney(4050, 'EUR')).toBe('4 050.00 EUR') })
  it('qty', () => { expect(formatQty(2, 'KG')).toBe('2 KG'); expect(formatQty(2.5, 'KG')).toBe('2.5 KG') })
  it('date', () => { expect(formatDate('2026-10-05T07:30:00Z')).toBe('05 Oct 2026') })
})
```

- [ ] **Step 7: Run to verify failure**  Run: `npm test --workspace apps/web`  Expected: FAIL.

- [ ] **Step 8: Implement store and format**

```ts
// src/store/ui.ts
import { create } from 'zustand'
import type { Role } from '@reclaim/shared'
type Theme = 'light' | 'dark' | 'system'
interface UiState { role: Role; theme: Theme; navCollapsed: boolean; setRole: (r: Role) => void; setTheme: (t: Theme) => void; toggleNav: () => void }
function applyTheme(t: Theme) { if (typeof document === 'undefined') return; if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t }
function read<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
const initialTheme = read<Theme>('reclaim.theme', 'system'); applyTheme(initialTheme)
export const useUi = create<UiState>((set) => ({
  role: read<Role>('reclaim.role', 'credit_manager'), theme: initialTheme, navCollapsed: read('reclaim.nav', false),
  setRole: (role) => { write('reclaim.role', role); set({ role }) },
  setTheme: (theme) => { write('reclaim.theme', theme); applyTheme(theme); set({ theme }) },
  toggleNav: () => set((s) => { write('reclaim.nav', !s.navCollapsed); return { navCollapsed: !s.navCollapsed } }),
}))
// src/lib/format.ts
export function formatMoney(n: number, currency = 'EUR'): string { const [int, dec] = n.toFixed(2).split('.'); return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${dec} ${currency}` }
export function formatQty(n: number, unit: string | null): string { const s = Number.isInteger(n) ? String(n) : String(n); return unit ? `${s} ${unit}` : s }
export function formatDate(iso: string): string { const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ (\w{3}) /, ' $1 ') }
export function formatDateTime(iso: string): string { const d = new Date(iso); return `${formatDate(iso)} ${d.toISOString().slice(11, 16)}` }
export function formatRelative(iso: string, now = Date.now()): string { const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)); if (s < 60) return `${s}s ago`; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; return `${Math.round(h / 24)} d ago` }
```
Note: `formatDate` with `en-GB` yields `05 Oct 2026`; if the runtime adds a comma, strip it with `.replace(',', '')`.

- [ ] **Step 9: main.tsx placeholder and verify**

`src/main.tsx` renders `<div className="p-6 font-sans">Reclaim</div>` inside `StrictMode` for now. Run: `npm test --workspace apps/web && npm run typecheck --workspace apps/web && npm run build --workspace apps/web`  Expected: PASS, build succeeds.

- [ ] **Step 10: Commit**  `git add apps/web package-lock.json && git commit -m "feat(web): vite scaffold, Deloitte theme tokens, ui store, formatters"`

---

### Task 4: API client interface, context, hooks, HTTP client, mock skeleton

**Files:**
- Create: `src/api/client.ts`, `src/api/context.tsx`, `src/api/hooks.ts`, `src/api/http/HttpApiClient.ts`, `src/api/mock/MockApiClient.ts`, `src/api/mock/store.ts`, `src/api/index.ts`
- Test: `src/api/mock/__tests__/client.test.ts`

**Interfaces:**
- Produces: `ApiClient` (spec §4), `ApproveResult`, `ReleaseResult`, `ApiEvent`; `createApiClient(): ApiClient` reading `import.meta.env.VITE_API_MODE`; hooks `useCases, useCase(id), useStatus, useSettings, useUpdateSettings, useRunCase, useRunAll, useSeed, useChoose, useApprove, useReject, useRelease, useAnalytics, useEval, useRunEval, useReset, useIngest`; `MockStore` with `cases: Map<string, Case>`, `settings`, `lastRunAt`, `evalResults`, `save()`, `load()`.
- Consumes: shared schemas and `toSummary`.

- [ ] **Step 1: client.ts**

```ts
import type { AgentStatus, AnalyticsSummary, Case, CaseSummary, EvalResult, Role, SapDocument, Settings } from '@reclaim/shared'
export type ApproveResult = { ok: true; document: SapDocument } | { ok: false; status: number; message: string }
export type ReleaseResult = { ok: true; document: SapDocument } | { ok: false; status: number; message: string }
export type ApiEvent = { type: 'case_changed'; id: string } | { type: 'status_changed' }
export interface ApproveInput { actor: string; role: Role; editedQuantity?: number; comment?: string }
export interface RejectInput { actor: string; role: Role; comment: string }
export interface ApiClient {
  listCases(): Promise<CaseSummary[]>; getCase(id: string): Promise<Case>; seedCases(): Promise<void>; ingest(files: File[]): Promise<CaseSummary[]>
  runCase(id: string): Promise<void>; runAll(): Promise<void>; chooseProposal(proposalId: string): Promise<void>
  approve(proposalId: string, input: ApproveInput): Promise<ApproveResult>; reject(proposalId: string, input: RejectInput): Promise<void>; release(sapDocumentId: string): Promise<ReleaseResult>
  getAnalytics(): Promise<AnalyticsSummary>; runEval(): Promise<EvalResult[]>; getLatestEval(): Promise<EvalResult[] | null>
  getStatus(): Promise<AgentStatus>; getSettings(): Promise<Settings>; updateSettings(patch: Partial<Settings>): Promise<Settings>; reset(): Promise<void>
  subscribe(listener: (e: ApiEvent) => void): () => void
}
export const CONFLICT_MESSAGE = 'The record changed in SAP since it was read. Nothing was written. Reload the case and approve again.'
```

- [ ] **Step 2: context.tsx and index.ts**

```tsx
// context.tsx
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from './client'
const Ctx = createContext<ApiClient | null>(null)
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const qc = useQueryClient()
  useEffect(() => client.subscribe((e) => { if (e.type === 'case_changed') { qc.invalidateQueries({ queryKey: ['cases'] }); qc.invalidateQueries({ queryKey: ['case', e.id] }); qc.invalidateQueries({ queryKey: ['analytics'] }) } qc.invalidateQueries({ queryKey: ['status'] }) }), [client, qc])
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>
}
export function useApi(): ApiClient { const c = useContext(Ctx); if (!c) throw new Error('ApiProvider missing'); return c }
// index.ts
import { HttpApiClient } from './http/HttpApiClient'; import { MockApiClient } from './mock/MockApiClient'; import type { ApiClient } from './client'
export function createApiClient(): ApiClient { return import.meta.env.VITE_API_MODE === 'http' ? new HttpApiClient(import.meta.env.VITE_API_BASE ?? '') : new MockApiClient() }
export * from './client'; export * from './context'; export * from './hooks'
```

- [ ] **Step 3: hooks.ts**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from './context'
import type { ApproveInput, RejectInput } from './client'
import type { Settings } from '@reclaim/shared'
export const useCases = () => { const api = useApi(); return useQuery({ queryKey: ['cases'], queryFn: () => api.listCases() }) }
export const useCase = (id: string) => { const api = useApi(); return useQuery({ queryKey: ['case', id], queryFn: () => api.getCase(id) }) }
export const useStatus = () => { const api = useApi(); return useQuery({ queryKey: ['status'], queryFn: () => api.getStatus(), refetchInterval: 5000 }) }
export const useSettings = () => { const api = useApi(); return useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() }) }
export const useAnalytics = () => { const api = useApi(); return useQuery({ queryKey: ['analytics'], queryFn: () => api.getAnalytics() }) }
export const useEval = () => { const api = useApi(); return useQuery({ queryKey: ['eval'], queryFn: () => api.getLatestEval() }) }
function useInvalidate() { const qc = useQueryClient(); return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })) }
export const useUpdateSettings = () => { const api = useApi(); const inv = useInvalidate(); return useMutation({ mutationFn: (p: Partial<Settings>) => api.updateSettings(p), onSuccess: () => inv('settings', 'status') }) }
export const useSeed = () => { const api = useApi(); const inv = useInvalidate(); return useMutation({ mutationFn: () => api.seedCases(), onSuccess: () => inv('cases', 'status') }) }
export const useIngest = () => { const api = useApi(); const inv = useInvalidate(); return useMutation({ mutationFn: (files: File[]) => api.ingest(files), onSuccess: () => inv('cases', 'status') }) }
export const useRunCase = () => { const api = useApi(); return useMutation({ mutationFn: (id: string) => api.runCase(id) }) }
export const useRunAll = () => { const api = useApi(); return useMutation({ mutationFn: () => api.runAll() }) }
export const useChoose = () => { const api = useApi(); return useMutation({ mutationFn: (proposalId: string) => api.chooseProposal(proposalId) }) }
export const useApprove = () => { const api = useApi(); return useMutation({ mutationFn: (v: { proposalId: string; input: ApproveInput }) => api.approve(v.proposalId, v.input) }) }
export const useReject = () => { const api = useApi(); return useMutation({ mutationFn: (v: { proposalId: string; input: RejectInput }) => api.reject(v.proposalId, v.input) }) }
export const useRelease = () => { const api = useApi(); return useMutation({ mutationFn: (id: string) => api.release(id) }) }
export const useRunEval = () => { const api = useApi(); const inv = useInvalidate(); return useMutation({ mutationFn: () => api.runEval(), onSuccess: () => inv('eval') }) }
export const useReset = () => { const api = useApi(); const qc = useQueryClient(); return useMutation({ mutationFn: () => api.reset(), onSuccess: () => qc.invalidateQueries() }) }
```

- [ ] **Step 4: HttpApiClient.ts**

```ts
import { API_ROUTES, CaseSchema, CaseSummarySchema, AgentStatusSchema, SettingsSchema, AnalyticsSummarySchema, EvalResultSchema, type Settings } from '@reclaim/shared'
import type { ApiClient, ApiEvent, ApproveInput, ApproveResult, RejectInput, ReleaseResult } from '../client'
import { z } from 'zod'
export class HttpApiClient implements ApiClient {
  constructor(private base: string) {}
  private url(path: string, params: Record<string, string> = {}) { return this.base + path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k] ?? '')) }
  private async call<T>(key: keyof typeof API_ROUTES, params: Record<string, string> = {}, body?: unknown, schema?: z.ZodType<T>): Promise<T> {
    const r = API_ROUTES[key]; const res = await fetch(this.url(r.path, params), { method: r.method, headers: body instanceof FormData ? {} : { 'content-type': 'application/json' }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) { const text = await res.text(); throw Object.assign(new Error(text || res.statusText), { status: res.status }) }
    const data = res.status === 204 ? undefined : await res.json(); return schema && import.meta.env.DEV ? schema.parse(data) : (data as T)
  }
  listCases() { return this.call('listCases', {}, undefined, z.array(CaseSummarySchema)) }
  getCase(id: string) { return this.call('getCase', { id }, undefined, CaseSchema) }
  async seedCases() { await this.call('seedCases') }
  ingest(files: File[]) { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); return this.call('ingest', {}, fd, z.array(CaseSummarySchema)) }
  async runCase(id: string) { await this.call('runCase', { id }) }
  async runAll() { await this.call('runAll') }
  async chooseProposal(id: string) { await this.call('chooseProposal', { id }) }
  async approve(id: string, input: ApproveInput): Promise<ApproveResult> { try { return { ok: true, document: await this.call('approve', { id }, input) } } catch (e) { const err = e as Error & { status?: number }; return { ok: false, status: err.status ?? 500, message: err.message } } }
  async reject(id: string, input: RejectInput) { await this.call('reject', { id }, input) }
  async release(id: string): Promise<ReleaseResult> { try { return { ok: true, document: await this.call('release', { id }) } } catch (e) { const err = e as Error & { status?: number }; return { ok: false, status: err.status ?? 500, message: err.message } } }
  getAnalytics() { return this.call('analytics', {}, undefined, AnalyticsSummarySchema) }
  runEval() { return this.call('runEval', {}, undefined, z.array(EvalResultSchema)) }
  getLatestEval() { return this.call('latestEval', {}, undefined, z.array(EvalResultSchema).nullable()) }
  getStatus() { return this.call('status', {}, undefined, AgentStatusSchema) }
  getSettings() { return this.call('getSettings', {}, undefined, SettingsSchema) }
  updateSettings(patch: Partial<Settings>) { return this.call('updateSettings', {}, patch, SettingsSchema) }
  async reset() { await this.call('reset') }
  subscribe(listener: (e: ApiEvent) => void) {
    if (typeof EventSource !== 'undefined') { const es = new EventSource(this.base + API_ROUTES.events.path); es.onmessage = (m) => listener(JSON.parse(m.data)); return () => es.close() }
    const t = setInterval(() => listener({ type: 'status_changed' }), 3000); return () => clearInterval(t)
  }
}
```

- [ ] **Step 5: Failing test for the mock skeleton**

```ts
// src/api/mock/__tests__/client.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MockApiClient } from '../MockApiClient'
describe('MockApiClient basics', () => {
  beforeEach(() => localStorage.clear())
  it('starts empty, seeds eight cases', async () => { const c = new MockApiClient({ fast: true }); expect(await c.listCases()).toHaveLength(0); await c.seedCases(); expect(await c.listCases()).toHaveLength(8); expect((await c.getStatus()).cases).toBe(8) })
  it('persists and restores', async () => { const a = new MockApiClient({ fast: true }); await a.seedCases(); const b = new MockApiClient({ fast: true }); expect(await b.listCases()).toHaveLength(8) })
  it('settings update and notify', async () => { const c = new MockApiClient({ fast: true }); let n = 0; c.subscribe(() => n++); await c.updateSettings({ aiMode: 'rules_only' }); expect((await c.getSettings()).aiMode).toBe('rules_only'); expect(n).toBe(1) })
})
```

- [ ] **Step 6: Run to verify failure**  Run: `npm test --workspace apps/web -- client`  Expected: FAIL.

- [ ] **Step 7: store.ts and MockApiClient.ts (skeleton; pipeline methods throw until Task 6)**

```ts
// src/api/mock/store.ts
import { CaseSchema, type Case, type EvalResult, type Settings } from '@reclaim/shared'
const KEY = 'reclaim.mock.v1'
export class MockStore {
  cases = new Map<string, Case>(); settings: Settings = { sapMode: 'mock', aiMode: 'assisted', simulateConflict: false }; lastRunAt: string | null = null; evalResults: EvalResult[] | null = null; nextDoc = 60000171
  load() { try { const raw = localStorage.getItem(KEY); if (!raw) return; const d = JSON.parse(raw); this.settings = d.settings; this.lastRunAt = d.lastRunAt; this.evalResults = d.evalResults; this.nextDoc = d.nextDoc; for (const c of d.cases as unknown[]) { const parsed = CaseSchema.parse(c); if (parsed.status === 'investigating' || parsed.status === 'proposed') parsed.status = 'received'; this.cases.set(parsed.id, parsed) } } catch { this.cases.clear() } }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ settings: this.settings, lastRunAt: this.lastRunAt, evalResults: this.evalResults, nextDoc: this.nextDoc, cases: [...this.cases.values()] })) } catch { /* ignore */ } }
  clear() { this.cases.clear(); this.settings = { sapMode: 'mock', aiMode: 'assisted', simulateConflict: false }; this.lastRunAt = null; this.evalResults = null; this.nextDoc = 60000171; try { localStorage.removeItem(KEY) } catch { /* ignore */ } }
}
// src/api/mock/MockApiClient.ts (skeleton)
import { toSummary, type Settings } from '@reclaim/shared'
import type { ApiClient, ApiEvent, ApproveInput, ApproveResult, RejectInput, ReleaseResult } from '../client'
import { MockStore } from './store'
import { buildFixtureCases } from './fixtures/cases'
export class MockApiClient implements ApiClient {
  protected store = new MockStore(); private listeners = new Set<(e: ApiEvent) => void>(); protected fast: boolean
  constructor(opts: { fast?: boolean } = {}) { this.fast = !!opts.fast; this.store.load() }
  protected emit(e: ApiEvent) { this.listeners.forEach((l) => l(e)) }
  protected delay(ms: number) { return new Promise<void>((r) => setTimeout(r, this.fast ? 0 : ms)) }
  protected touch(id: string) { const c = this.store.cases.get(id); if (c) c.updatedAt = new Date().toISOString(); this.store.save(); this.emit({ type: 'case_changed', id }) }
  async listCases() { return [...this.store.cases.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).map(toSummary) }
  async getCase(id: string) { const c = this.store.cases.get(id); if (!c) throw Object.assign(new Error('Case not found'), { status: 404 }); return structuredClone(c) }
  async seedCases() { for (const c of buildFixtureCases()) if (!this.store.cases.has(c.id)) this.store.cases.set(c.id, c); this.store.save(); this.emit({ type: 'status_changed' }) }
  async ingest(_files: File[]) { throw new Error('implemented in Task 6') }
  async runCase(_id: string) { throw new Error('implemented in Task 6') }
  async runAll() { throw new Error('implemented in Task 6') }
  async chooseProposal(_id: string) { throw new Error('implemented in Task 6') }
  async approve(_id: string, _i: ApproveInput): Promise<ApproveResult> { throw new Error('implemented in Task 6') }
  async reject(_id: string, _i: RejectInput) { throw new Error('implemented in Task 6') }
  async release(_id: string): Promise<ReleaseResult> { throw new Error('implemented in Task 6') }
  async getAnalytics() { throw new Error('implemented in Task 6') }
  async runEval() { throw new Error('implemented in Task 6') }
  async getLatestEval() { return this.store.evalResults }
  async getStatus() { const cases = [...this.store.cases.values()]; return { name: 'Reclaim · Returns & Credit Note', agentId: 'o2c-agent-8', cases: cases.length, pending: cases.filter((c) => c.status === 'awaiting_approval').length, lastRunAt: this.store.lastRunAt, sapMode: this.store.settings.sapMode, aiMode: this.store.settings.aiMode } }
  async getSettings() { return { ...this.store.settings } }
  async updateSettings(patch: Partial<Settings>) { this.store.settings = { ...this.store.settings, ...patch }; this.store.save(); this.emit({ type: 'status_changed' }); return { ...this.store.settings } }
  async reset() { this.store.clear(); this.emit({ type: 'status_changed' }) }
  subscribe(l: (e: ApiEvent) => void) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
}
```
Create a temporary `fixtures/cases.ts` exporting `buildFixtureCases(): Case[]` returning eight minimal valid cases (ids `case-01` … `case-08`, status `received`, empty arrays) so the test passes; Task 5 replaces it.

- [ ] **Step 8: Run tests**  Run: `npm test --workspace apps/web && npm run typecheck --workspace apps/web`  Expected: PASS.

- [ ] **Step 9: Commit**  `git add apps/web && git commit -m "feat(web): ApiClient contract, hooks, http client and mock skeleton"`

---

### Task 5: Rules engine in shared, SAP payload builder, narrative templates

The rules engine lives in `packages/shared` so the backend team can reuse it unchanged. It is a pure function from facts and findings to one or two decisions.

**Files:**
- Create: `packages/shared/src/rules.ts`, `packages/shared/src/sap-payload.ts`, `packages/shared/src/narrative.ts`; add exports to `src/index.ts`
- Test: `packages/shared/src/__tests__/rules.test.ts`

**Interfaces:**
- Produces: `decide(facts: Facts, findings: Findings, ctx: { openCaseOnInvoice: string | null }): { options: Decision[]; recommendedIndex: number }`; `buildSapPayload(d: Decision, invoice: InvoiceSnapshot, complaintRef: string): Record<string, unknown> | null`; `narrate(d: Decision, facts: Facts, findings: Findings, ctx: { existingDocNumber?: string; openCaseId?: string; candidate?: InvoiceSnapshot }): { explanation: string; replyDraft: string; briefing: Briefing; citations: { ruleId: RuleId; text: string }[] }`.

- [ ] **Step 1: Failing tests**

```ts
// packages/shared/src/__tests__/rules.test.ts
import { describe, it, expect } from 'vitest'
import { decide } from '../rules'
import type { Facts, Findings, InvoiceSnapshot } from '../schemas'
const inv = (number: string, quantity: number, plant = 'YGLG'): InvoiceSnapshot => ({ number, date: '2026-09-29', customer: '10021', customerName: 'Cust DE 1', salesOrg: 'YSOD', distributionChannel: 'Y1', division: 'Y5', companyCode: 'YDE1', currency: 'EUR', totalNetAmount: quantity * 270, etag: 'W/"1"', items: [{ item: '10', material: '54', description: 'Soda material (HAWA)', quantity, unit: 'KG', netAmount: quantity * 270, unitPrice: 270, plant, salesOrder: '1610', delivery: '80608800' }] })
const facts = (p: Partial<Facts>): Facts => ({ invoiceNumber: '90000353', material: '54', claimedQuantity: 2, unit: 'KG', complaintType: 'damaged', claimedUnitPrice: null, wantsReplacement: false, goodsReturnable: null, evidence: '', language: 'en', ...p })
const findings = (p: Partial<Findings>): Findings => ({ invoice: inv('90000353', 5), candidateInvoices: [], existingReturns: [], existingCredits: [], agreedUnitPrice: 270, plantCompanyCode: 'YDE1', lookups: [], ...p })
const ctx = { openCaseOnInvoice: null }
describe('decide', () => {
  it('damaged + leaked: two options, R3 recommended, 540 EUR, credit manager', () => {
    const r = decide(facts({ goodsReturnable: false }), findings({}), ctx)
    expect(r.options.map((o) => o.ruleId)).toEqual(['R1', 'R3']); expect(r.recommendedIndex).toBe(1)
    expect(r.options[1]).toMatchObject({ documentType: 'YCR', reasonCode: '104', quantity: 2, amount: 540, approverRole: 'credit_manager' })
    expect(r.options[0]).toMatchObject({ documentType: 'YRE', reasonCode: '102', approverRole: 'credit_manager' })
  })
  it('price equal to agreed: R4, no document, credit manager confirms', () => {
    const r = decide(facts({ invoiceNumber: '90000354', complaintType: 'price', claimedQuantity: 12, claimedUnitPrice: 260 }), findings({ invoice: inv('90000354', 12) }), ctx)
    expect(r.options[0]).toMatchObject({ ruleId: 'R4', documentType: 'NONE', amount: 0, approverRole: 'credit_manager' })
  })
  it('price above agreed: R4 credits the difference', () => {
    const f = findings({ invoice: inv('90000354', 12), agreedUnitPrice: 260 })
    expect(decide(facts({ invoiceNumber: '90000354', complaintType: 'price', claimedQuantity: 12, claimedUnitPrice: 260 }), f, ctx).options[0]).toMatchObject({ ruleId: 'R4', documentType: 'YCR', reasonCode: '101', amount: 120 })
  })
  it('short delivery: R5 YCR 103', () => { expect(decide(facts({ invoiceNumber: '90000355', complaintType: 'short_delivery' }), findings({ invoice: inv('90000355', 20) }), ctx).options[0]).toMatchObject({ ruleId: 'R5', documentType: 'YCR', reasonCode: '103', quantity: 2, amount: 540, approverRole: 'credit_manager' }) })
  it('over quantity: R7, nothing', () => { expect(decide(facts({ invoiceNumber: '90000356', complaintType: 'quality', claimedQuantity: 10 }), findings({ invoice: inv('90000356', 8) }), ctx).options[0]).toMatchObject({ ruleId: 'R7', documentType: 'NONE', quantity: 0, amount: 0, approverRole: null }) })
  it('no invoice: R9 proposes candidate, needs confirmation', () => { const r = decide(facts({ invoiceNumber: null, complaintType: 'quality', claimedQuantity: 15 }), findings({ invoice: null, candidateInvoices: [inv('90000357', 15)] }), ctx).options[0]; expect(r).toMatchObject({ ruleId: 'R9', documentType: 'NONE', quantity: 15, amount: 4050, requiresCustomerConfirmation: true }) })
  it('duplicate via SAP document or open case: R8', () => {
    expect(decide(facts({}), findings({ existingCredits: [{ type: 'YCR', number: '60000171', reasonCode: '104', amount: 540, billingBlock: '08' }] }), ctx).options[0].ruleId).toBe('R8')
    expect(decide(facts({}), findings({}), { openCaseOnInvoice: 'case-01' }).options[0].ruleId).toBe('R8')
  })
  it('replacement: R6', () => { expect(decide(facts({ invoiceNumber: '90000358', complaintType: 'ruined', claimedQuantity: 5, wantsReplacement: true }), findings({ invoice: inv('90000358', 5) }), ctx).options[0]).toMatchObject({ ruleId: 'R6', documentType: 'NONE', quantity: 5, amount: 1350 }) })
  it('intercompany flag when plant company differs', () => { const r = decide(facts({ invoiceNumber: '90000359', claimedQuantity: 3, goodsReturnable: true }), findings({ invoice: inv('90000359', 10, 'YRO1'), plantCompanyCode: 'YRO1' }), ctx); expect(r.options[r.recommendedIndex]).toMatchObject({ ruleId: 'R1', intercompany: true, amount: 810, approverRole: 'credit_manager' }) })
  it('quantity capped and amount from invoice price', () => { expect(decide(facts({ complaintType: 'quality', claimedQuantity: 5 }), findings({}), ctx).options[0]).toMatchObject({ ruleId: 'R2', quantity: 5, amount: 1350 }) })
})
```

- [ ] **Step 2: Run to verify failure**  Run: `npm test --workspace packages/shared -- rules`  Expected: FAIL.

- [ ] **Step 3: rules.ts**

```ts
import type { Decision, Facts, Findings, InvoiceSnapshot } from './schemas'
import { approverFor, capQuantity, RULES } from './policy'
import type { RuleId } from './enums'
export interface DecideContext { openCaseOnInvoice: string | null }
export interface DecideResult { options: Decision[]; recommendedIndex: number }
function base(ruleId: RuleId, inv: InvoiceSnapshot | null, qty: number, amount: number, extra: Partial<Decision> = {}): Decision {
  const rule = RULES[ruleId]; const item = inv?.items[0]
  const approver = rule.documentType === 'NONE' ? null : approverFor(amount, ruleId)
  return { ruleId, documentType: rule.documentType, reasonCode: rule.reasonCode, material: item?.material ?? null, quantity: qty, unit: item?.unit ?? null, amount, currency: inv?.currency ?? 'EUR', approverRole: approver, intercompany: false, requiresCustomerConfirmation: false, notes: '', ...extra }
}
export function decide(facts: Facts, findings: Findings, ctx: DecideContext): DecideResult {
  const inv = findings.invoice
  if (!facts.invoiceNumber) {
    const cand = findings.candidateInvoices[0]
    if (!cand) return { options: [base('NONE', null, 0, 0, { notes: 'No invoice named and no candidate invoice found for this customer and material.' })], recommendedIndex: 0 }
    const qty = capQuantity(facts.claimedQuantity ?? cand.items[0]!.quantity, cand.items[0]!.quantity)
    return { options: [base('R9', cand, qty, qty * cand.items[0]!.unitPrice, { requiresCustomerConfirmation: true, notes: `Likely match: invoice ${cand.number} (${cand.items[0]!.quantity} ${cand.items[0]!.unit} of ${cand.items[0]!.material}, ${cand.date}). Ask the customer to confirm before creating anything.` })], recommendedIndex: 0 }
  }
  if (!inv) return { options: [base('NONE', null, 0, 0, { notes: `Invoice ${facts.invoiceNumber} was not found in SAP.` })], recommendedIndex: 0 }
  const item = inv.items[0]!; const intercompany = !!findings.plantCompanyCode && findings.plantCompanyCode !== inv.companyCode
  const existing = findings.existingReturns[0] ?? findings.existingCredits[0]
  if (existing || ctx.openCaseOnInvoice) return { options: [base('R8', inv, 0, 0, { intercompany, notes: existing ? `A ${existing.type} ${existing.number} already exists for invoice ${inv.number}.` : `Complaint for invoice ${inv.number} is already in progress (${ctx.openCaseOnInvoice}); no document created yet.` })], recommendedIndex: 0 }
  const claimed = facts.claimedQuantity ?? item.quantity
  if (facts.wantsReplacement) return { options: [base('R6', inv, capQuantity(claimed, item.quantity), capQuantity(claimed, item.quantity) * item.unitPrice, { intercompany, notes: 'Customer asks for a replacement delivery. Handed over to customer service; no credit.' })], recommendedIndex: 0 }
  if (claimed > item.quantity) return { options: [base('R7', inv, 0, 0, { intercompany, notes: `Claimed ${claimed} ${item.unit} but invoice ${inv.number} is for ${item.quantity} ${item.unit}.` })], recommendedIndex: 0 }
  const qty = capQuantity(claimed, item.quantity)
  if (facts.complaintType === 'price') {
    const agreed = findings.agreedUnitPrice ?? item.unitPrice
    if (agreed >= item.unitPrice) return { options: [base('R4', inv, 0, 0, { intercompany, approverRole: 'credit_manager', notes: `Agreed price (PR00) is ${agreed.toFixed(2)} ${inv.currency}/${item.unit}, invoiced ${item.unitPrice.toFixed(2)}. The claim of ${facts.claimedUnitPrice ?? '?'} is not supported by SAP data. No credit unless a person confirms a special agreement.` })], recommendedIndex: 0 }
    const diff = (item.unitPrice - agreed) * qty
    return { options: [base('R4', inv, qty, diff, { intercompany, notes: `Invoiced ${item.unitPrice.toFixed(2)} vs agreed ${agreed.toFixed(2)} per ${item.unit}: credit the difference.` })], recommendedIndex: 0 }
  }
  const amount = qty * item.unitPrice
  if (facts.complaintType === 'short_delivery') return { options: [base('R5', inv, qty, amount, { intercompany, notes: 'Ask the warehouse to check proof of delivery.' })], recommendedIndex: 0 }
  if (facts.complaintType === 'damaged') { const a = base('R1', inv, qty, amount, { intercompany }); const b = base('R3', inv, qty, amount, { intercompany, notes: 'Credit only; photo evidence required.' }); return { options: [a, b], recommendedIndex: facts.goodsReturnable === false ? 1 : 0 } }
  if (facts.complaintType === 'ruined') return { options: [base('R3', inv, qty, amount, { intercompany, notes: 'Credit only; photo evidence required.' })], recommendedIndex: 0 }
  if (facts.complaintType === 'quality') return { options: [base('R2', inv, qty, amount, { intercompany })], recommendedIndex: 0 }
  return { options: [base('NONE', inv, 0, 0, { intercompany, approverRole: 'customer_service_lead', notes: 'No rule in the policy matches this complaint. A person must decide; consider extending the policy.' })], recommendedIndex: 0 }
}
```

- [ ] **Step 4: sap-payload.ts**

```ts
import type { Decision, InvoiceSnapshot } from './schemas'
import { BILLING_BLOCK } from './policy'
export function buildSapPayload(d: Decision, inv: InvoiceSnapshot, complaintRef: string): Record<string, unknown> | null {
  if (d.documentType === 'NONE') return null
  const item = inv.items[0]!
  const items = [{ Material: item.material, RequestedQuantity: String(d.quantity), RequestedQuantityUnit: item.unit, ReferenceSDDocument: inv.number, ReferenceSDDocumentItem: item.item }]
  const common = { SalesOrganization: inv.salesOrg, DistributionChannel: inv.distributionChannel, OrganizationDivision: inv.division, SoldToParty: inv.customer, SDDocumentReason: d.reasonCode, PurchaseOrderByCustomer: complaintRef }
  return d.documentType === 'YRE' ? { CustomerReturnType: 'YRE', ...common, to_Item: items } : { CreditMemoRequestType: 'YCR', ...common, HeaderBillingBlockReason: BILLING_BLOCK, ReferenceSDDocument: inv.number, to_Item: items }
}
```

- [ ] **Step 5: narrative.ts**

```ts
import type { Briefing, Decision, Facts, Findings, InvoiceSnapshot } from './schemas'
import { RULES, REASON_CODES, ROLE_LABELS } from './policy'
import type { RuleId } from './enums'
function money(n: number, c: string) { return `${n.toFixed(2)} ${c}` }
export function narrate(d: Decision, facts: Facts, f: Findings, ctx: { existingDocNumber?: string; openCaseId?: string } = {}): { explanation: string; replyDraft: string; briefing: Briefing; citations: { ruleId: RuleId; text: string }[] } {
  const inv = f.invoice ?? f.candidateInvoices[0] ?? null; const item = inv?.items[0]; const rule = RULES[d.ruleId]
  const docName = d.documentType === 'YRE' ? 'customer return (YRE)' : d.documentType === 'YCR' ? 'credit memo request (YCR)' : 'no SAP document'
  const citations = [{ ruleId: d.ruleId, text: rule.policyText }]
  const ic = d.intercompany ? ` The invoice was issued by company ${inv?.companyCode} but the goods shipped from a ${f.plantCompanyCode} plant: an intercompany credit must be flagged for finance (step 5.2.2).` : ''
  const head = inv ? `Invoice ${inv.number} (${inv.date}) for customer ${inv.customerName} (${inv.customer}): ${item!.quantity} ${item!.unit} of material ${item!.material} at ${money(item!.unitPrice, inv.currency)} per ${item!.unit}, from order ${item!.salesOrder} and delivery ${item!.delivery}.` : 'No invoice number was named in the complaint.'
  const greeting = `Dear ${facts.language === 'de' ? 'Sir or Madam' : 'customer'},`
  let explanation = '', reply = '', b: Briefing
  switch (d.ruleId) {
    case 'R1': explanation = `${head} The customer reports ${d.quantity} ${d.unit} damaged in transit. Rule R1 applies: take the damaged quantity back and credit after receipt. Proposed: ${docName}, reason ${d.reasonCode} (${REASON_CODES[d.reasonCode!]}), ${d.quantity} ${d.unit}, value ${money(d.amount, d.currency)}, billing block 08 until ${ROLE_LABELS[d.approverRole!]} approves.${ic}`; reply = `${greeting}\n\nThank you for reporting the damage on invoice ${inv?.number}. We are arranging the collection of the ${d.quantity} ${d.unit} affected and will credit ${money(d.amount, d.currency)} once the goods are received in our warehouse.\n\nKind regards,\nReturns desk`; b = { whatHappened: `${d.quantity} ${d.unit} of material ${d.material} damaged in transit on invoice ${inv?.number}.`, whatWePropose: `Return (YRE, reason ${d.reasonCode}) for ${d.quantity} ${d.unit}, credit ${money(d.amount, d.currency)} after receipt.`, risk: d.intercompany ? 'Intercompany credit must also be booked.' : 'Low: credit only after goods are received.' }; break
    case 'R2': explanation = `${head} The customer reports poor quality and can return the goods. Rule R2 applies: ${docName}, reason ${d.reasonCode} (${REASON_CODES[d.reasonCode!]}), ${d.quantity} ${d.unit}, ${money(d.amount, d.currency)}, billing block 08 until ${ROLE_LABELS[d.approverRole!]} approves.${ic}`; reply = `${greeting}\n\nThank you for your message about invoice ${inv?.number}. We will collect the ${d.quantity} ${d.unit} and credit ${money(d.amount, d.currency)} after receipt and inspection.\n\nKind regards,\nReturns desk`; b = { whatHappened: `Quality complaint on ${d.quantity} ${d.unit} of material ${d.material}, invoice ${inv?.number}.`, whatWePropose: `Return (YRE, reason 101), credit ${money(d.amount, d.currency)} after receipt.`, risk: 'Low: goods come back before any credit.' }; break
    case 'R3': explanation = `${head} The goods are ruined (${facts.evidence || 'leaked'}) and cannot be returned. Rule R3 applies: credit only, with photo evidence. Proposed: ${docName}, reason ${d.reasonCode} (${REASON_CODES[d.reasonCode!]}), ${d.quantity} ${d.unit}, ${money(d.amount, d.currency)}, billing block 08 until ${ROLE_LABELS[d.approverRole!]} approves.${ic}`; reply = `${greeting}\n\nThank you for the photo and the details on invoice ${inv?.number}. We are preparing a credit of ${money(d.amount, d.currency)} for the ${d.quantity} ${d.unit} lost. You will receive the credit note after approval.\n\nKind regards,\nReturns desk`; b = { whatHappened: `${d.quantity} ${d.unit} of material ${d.material} lost (leaking) on invoice ${inv?.number}; photo attached.`, whatWePropose: `Credit memo request (YCR, reason 104) for ${money(d.amount, d.currency)}, no goods back.`, risk: 'Credit without goods returning: credit manager at least.' }; break
    case 'R4': explanation = d.documentType === 'NONE' ? `${head} The customer claims an agreed price of ${facts.claimedUnitPrice ?? '?'} ${d.currency}/${item?.unit}. The agreed price on file (PR00, ${inv?.salesOrg}/${inv?.distributionChannel}, material ${item?.material}) is ${money(f.agreedUnitPrice ?? item!.unitPrice, d.currency)} per ${item?.unit}, the same as invoiced. Rule R4: the claim is not supported by SAP data; no credit unless a person confirms a special agreement.` : `${head} ${d.notes} Rule R4: credit the difference, ${money(d.amount, d.currency)}, via ${docName}.`; reply = d.documentType === 'NONE' ? `${greeting}\n\nThank you for your message about invoice ${inv?.number}. Our records show an agreed price of ${money(f.agreedUnitPrice ?? item!.unitPrice, d.currency)} per ${item?.unit} for material ${item?.material}, which is the price invoiced. If you hold a written agreement for a different price, please send it and we will review it.\n\nKind regards,\nReturns desk` : `${greeting}\n\nYou are right: invoice ${inv?.number} used a higher price than agreed. A credit of ${money(d.amount, d.currency)} is being prepared.\n\nKind regards,\nReturns desk`; b = { whatHappened: `Price complaint on invoice ${inv?.number}: customer claims ${facts.claimedUnitPrice ?? '?'} ${d.currency}/${item?.unit}.`, whatWePropose: d.documentType === 'NONE' ? 'No credit: invoiced price equals the agreed PR00 price. Send the reply with the evidence.' : `Credit the difference, ${money(d.amount, d.currency)}.`, risk: d.documentType === 'NONE' ? 'A special agreement may exist outside SAP; confirm before replying.' : 'Credit without goods back.' }; break
    case 'R5': explanation = `${head} Only ${(item?.quantity ?? 0) - d.quantity} ${d.unit} arrived. Rule R5: credit the missing ${d.quantity} ${d.unit} (${money(d.amount, d.currency)}) via ${docName}, reason ${d.reasonCode}, and ask the warehouse to check proof of delivery.${ic}`; reply = `${greeting}\n\nThank you for reporting the short delivery on invoice ${inv?.number}. We are checking the proof of delivery and preparing a credit of ${money(d.amount, d.currency)} for the ${d.quantity} ${d.unit} missing.\n\nKind regards,\nReturns desk`; b = { whatHappened: `Short delivery on invoice ${inv?.number}: ${d.quantity} ${d.unit} missing.`, whatWePropose: `Credit memo request (YCR, reason 103) for ${money(d.amount, d.currency)}.`, risk: 'Credit without goods back; proof of delivery not yet checked.' }; break
    case 'R6': explanation = `${head} The customer explicitly asks for a replacement, not a credit. Rule R6: no credit; hand over to customer service for a free re-delivery of ${d.quantity} ${d.unit} and collection of the bad goods.${ic}`; reply = `${greeting}\n\nThank you for your message about invoice ${inv?.number}. Customer service will contact you to arrange a replacement delivery of ${d.quantity} ${d.unit} and the collection of the affected goods.\n\nKind regards,\nReturns desk`; b = { whatHappened: `Replacement requested for ${d.quantity} ${d.unit} on invoice ${inv?.number}.`, whatWePropose: 'Hand over to customer service for a free re-delivery. No SAP document.', risk: 'None for credit; delivery cost sits with customer service.' }; break
    case 'R7': explanation = `${head} ${d.notes} Rule R7: refuse and ask the customer to correct the quantity. No document.`; reply = `${greeting}\n\nThank you for your message. Invoice ${inv?.number} covers ${item?.quantity} ${item?.unit} of material ${item?.material}, so we cannot process a return of ${facts.claimedQuantity} ${item?.unit}. Please check the invoice number or the quantity and resend your request.\n\nKind regards,\nReturns desk`; b = { whatHappened: `Customer wants to return ${facts.claimedQuantity} ${item?.unit}; invoice ${inv?.number} is for ${item?.quantity} ${item?.unit}.`, whatWePropose: 'Refuse; ask the customer to correct.', risk: 'None.' }; break
    case 'R8': explanation = `${head} ${d.notes} Rule R8: do not create a second document; answer with the existing reference.`; reply = `${greeting}\n\nThank you for following up on invoice ${inv?.number}. Your complaint is already being processed${ctx.existingDocNumber ? ` under document ${ctx.existingDocNumber}` : ''} and you will be informed as soon as the credit is released.\n\nKind regards,\nReturns desk`; b = { whatHappened: `Follow-up on invoice ${inv?.number}.`, whatWePropose: ctx.existingDocNumber ? `Reply with existing document ${ctx.existingDocNumber}; create nothing.` : `Reply that the complaint is in progress (${ctx.openCaseId}); create nothing.`, risk: 'Duplicate credit prevented.' }; break
    case 'R9': explanation = `The complaint names no invoice. Searching the customer's invoices for material ${d.material} in the last weeks found ${f.candidateInvoices.length} candidate(s). ${d.notes} Rule R9: propose the match and ask the customer to confirm; no document until confirmed. If confirmed, a customer return (YRE, reason 101) for ${d.quantity} ${d.unit} (${money(d.amount, d.currency)}) follows.`; reply = `${greeting}\n\nThank you for your message about the discoloured material. We believe it relates to invoice ${inv?.number} of ${inv?.date} (${item?.quantity} ${item?.unit} of material ${item?.material}). Please confirm, and we will arrange the collection and the credit.\n\nKind regards,\nReturns desk`; b = { whatHappened: `Quality complaint on ${d.quantity} ${d.unit} without an invoice number.`, whatWePropose: `Ask the customer to confirm invoice ${inv?.number}; then return (YRE, 101).`, risk: 'Wrong invoice if the customer does not confirm.' }; break
    default: explanation = `${head} ${d.notes}`; reply = `${greeting}\n\nThank you for your message. We are reviewing it and will come back to you shortly.\n\nKind regards,\nReturns desk`; b = { whatHappened: 'Complaint does not match any policy rule.', whatWePropose: 'A person decides; consider extending the policy.', risk: 'Policy gap.' }
  }
  return { explanation, replyDraft: reply, briefing: b, citations }
}
```
Add to `index.ts`: `export * from './rules'; export * from './sap-payload'; export * from './narrative'`.

- [ ] **Step 6: Run tests and typecheck**  Run: `npm test --workspace packages/shared && npm run typecheck --workspace packages/shared`  Expected: PASS.

- [ ] **Step 7: Commit**  `git add packages/shared && git commit -m "feat(shared): rules engine, SAP payload builder and narrative templates"`

---

### Task 6: Fixtures and the mock pipeline

**Files:**
- Create: `apps/web/src/api/mock/fixtures/cases.ts` (replace), `fixtures/invoices.ts`, `fixtures/expected.ts`, `fixtures/history.ts`, `apps/web/src/api/mock/pipeline.ts`, `apps/web/public/mock/damaged-drums-90000353.png` (copy from mock-data), `mock-data/extra/08-intercompany.eml`
- Modify: `apps/web/src/api/mock/MockApiClient.ts` (replace the throwing methods)
- Test: `apps/web/src/api/mock/__tests__/pipeline.test.ts`

**Interfaces:**
- Produces: `FIXTURES: FixtureCase[]` where `FixtureCase = { id, emailFile, receivedAt, from, subject, bodyText, attachments, facts, invoiceNumbers: string[] (which invoices the lookups find), candidateInvoices: string[], existingCredits: ExistingDoc[] }`; `INVOICES: Record<string, InvoiceSnapshot>`; `PLANT_COMPANY: Record<string, string>` (`YGLG: 'YDE1', YRO1: 'YRO1'`); `EXPECTED: Record<caseId, { rule, document, reason, quantity, amount, approver, optionA?: {...} }>`; `runPipeline(client, caseId)`.

- [ ] **Step 1: invoices.ts**

```ts
import type { InvoiceSnapshot } from '@reclaim/shared'
const mk = (number: string, quantity: number, order: string, delivery: string, plant = 'YGLG', date = '2026-09-29', etagTs = '2026-09-29T10:06:03'): InvoiceSnapshot => ({ number, date, customer: '10021', customerName: 'Cust DE 1', salesOrg: 'YSOD', distributionChannel: 'Y1', division: 'Y5', companyCode: 'YDE1', currency: 'EUR', totalNetAmount: quantity * 270, etag: `W/"datetimeoffset'${etagTs}'"`, items: [{ item: '10', material: '54', description: 'Soda material (HAWA) - RO, DE, CH Plant', quantity, unit: 'KG', netAmount: quantity * 270, unitPrice: 270, plant, salesOrder: order, delivery }] })
export const INVOICES: Record<string, InvoiceSnapshot> = {
  '90000353': mk('90000353', 5, '1610', '80608800'), '90000354': mk('90000354', 12, '1611', '80608801', 'YGLG', '2026-09-29', '2026-09-29T10:08:00'), '90000355': mk('90000355', 20, '1612', '80608802'), '90000356': mk('90000356', 8, '1613', '80608803'), '90000357': mk('90000357', 15, '1614', '80608804'), '90000358': mk('90000358', 5, '1615', '80608805'), '90000359': mk('90000359', 10, '1616', '80608806', 'YRO1'),
}
export const PLANT_COMPANY: Record<string, string> = { YGLG: 'YDE1', YRO1: 'YRO1' }
export const AGREED_PRICE = { material: '54', salesOrg: 'YSOD', channel: 'Y1', conditionType: 'PR00', unitPrice: 270, unit: 'KG', currency: 'EUR' }
```

- [ ] **Step 2: cases.ts**

Each entry copies the body text from the `.eml` in `mock-data/emails` verbatim. Facts are what the extraction model would produce.

```ts
import type { Case, ExistingDoc, Facts, Attachment } from '@reclaim/shared'
export interface FixtureCase { id: string; emailFile: string; receivedAt: string; from: string; subject: string; bodyText: string; attachments: Attachment[]; facts: Facts; invoiceNumbers: string[]; candidateInvoices: string[]; existingCredits: ExistingDoc[] }
const F = (p: Partial<Facts>): Facts => ({ invoiceNumber: null, material: '54', claimedQuantity: null, unit: 'KG', complaintType: 'unknown', claimedUnitPrice: null, wantsReplacement: false, goodsReturnable: null, evidence: '', language: 'en', ...p })
export const FIXTURES: FixtureCase[] = [
  { id: 'case-01', emailFile: '01-complaint-damaged.eml', receivedAt: '2026-10-05T07:30:00Z', from: 'Quality, Cust DE 1 <quality@cust-de-1.example>', subject: 'Complaint on invoice 90000353 – damaged drums', bodyText: 'Hello,\n\nTwo of the drums delivered with invoice 90000353 (item 10, material 54, 5 KG in total) arrived\ndamaged and leaking: 2 KG are lost. Photo attached. Please credit or replace.\n\nRegards,\nQuality department, Cust DE 1', attachments: [{ name: 'damaged-drums-90000353.png', mimeType: 'image/png', url: '/mock/damaged-drums-90000353.png' }], facts: F({ invoiceNumber: '90000353', claimedQuantity: 2, complaintType: 'damaged', goodsReturnable: false, evidence: 'two drums leaking, 2 KG lost, photo attached' }), invoiceNumbers: ['90000353'], candidateInvoices: [], existingCredits: [] },
  { id: 'case-02', emailFile: '02-complaint-price.eml', receivedAt: '2026-10-05T07:40:00Z', from: 'Accounts Payable, Cust DE 1 <ap@cust-de-1.example>', subject: 'Price difference on invoice 90000354', bodyText: 'Hello,\n\nWe were invoiced 3 240.00 EUR for 12 KG of material 54 on invoice 90000354.\nOur agreed price is 260 EUR per KG, so we expect 3 120.00 EUR. Please issue a credit note for the difference.\n\nAccounts Payable, Cust DE 1', attachments: [], facts: F({ invoiceNumber: '90000354', claimedQuantity: 12, complaintType: 'price', claimedUnitPrice: 260, evidence: 'claims agreed price 260 EUR/KG, expects 3 120.00 EUR' }), invoiceNumbers: ['90000354'], candidateInvoices: [], existingCredits: [] },
  { id: 'case-03', emailFile: '03-complaint-short-delivery.eml', receivedAt: '2026-10-05T07:50:00Z', from: 'Warehouse, Cust DE 1 <warehouse@cust-de-1.example>', subject: 'Short delivery – invoice 90000355', bodyText: 'Hello,\n\nInvoice 90000355 charges 20 KG of material 54 but only 18 KG arrived. Please credit the 2 KG missing.\n\nWarehouse, Cust DE 1', attachments: [], facts: F({ invoiceNumber: '90000355', claimedQuantity: 2, complaintType: 'short_delivery', evidence: '20 KG invoiced, 18 KG arrived' }), invoiceNumbers: ['90000355'], candidateInvoices: [], existingCredits: [] },
  { id: 'case-04', emailFile: '04-complaint-over-quantity.eml', receivedAt: '2026-10-05T08:00:00Z', from: 'Quality, Cust DE 1 <quality@cust-de-1.example>', subject: 'Return 10 KG – invoice 90000356', bodyText: 'Hello,\n\nWe want to return 10 KG of material 54 from invoice 90000356 – quality not as expected.\n\nQuality department, Cust DE 1', attachments: [], facts: F({ invoiceNumber: '90000356', claimedQuantity: 10, complaintType: 'quality', goodsReturnable: true, evidence: 'quality not as expected' }), invoiceNumbers: ['90000356'], candidateInvoices: [], existingCredits: [] },
  { id: 'case-05', emailFile: '05-complaint-no-invoice.eml', receivedAt: '2026-10-05T08:10:00Z', from: 'Quality, Cust DE 1 <quality@cust-de-1.example>', subject: 'Bad batch received last week', bodyText: 'Hello,\n\nThe 15 KG of material 54 we received last week is discoloured. We do not want to use it.\nPlease take it back and credit us.\n\nQuality department, Cust DE 1', attachments: [], facts: F({ invoiceNumber: null, claimedQuantity: 15, complaintType: 'quality', goodsReturnable: true, evidence: 'discoloured, received last week' }), invoiceNumbers: [], candidateInvoices: ['90000357'], existingCredits: [] },
  { id: 'case-06', emailFile: '06-complaint-duplicate.eml', receivedAt: '2026-10-06T07:30:00Z', from: 'Quality, Cust DE 1 <quality@cust-de-1.example>', subject: 'RE: Complaint on invoice 90000353 – damaged drums', bodyText: 'Hello,\n\nAny news on our complaint about invoice 90000353 (2 KG leaking)? Please confirm the credit.\n\nQuality department, Cust DE 1', attachments: [], facts: F({ invoiceNumber: '90000353', claimedQuantity: 2, complaintType: 'follow_up', goodsReturnable: false, evidence: 'follow-up on earlier complaint' }), invoiceNumbers: ['90000353'], candidateInvoices: [], existingCredits: [] },
  { id: 'case-07', emailFile: '07-replacement-request.eml', receivedAt: '2026-10-05T08:30:00Z', from: 'Quality, Cust DE 1 <quality@cust-de-1.example>', subject: 'Replacement needed – invoice 90000358', bodyText: 'Hello,\n\n5 KG of material 54 from invoice 90000358 are contaminated. We do not want a credit:\nplease replace them with a new delivery as soon as possible and collect the bad goods.\n\nQuality department, Cust DE 1', attachments: [], facts: F({ invoiceNumber: '90000358', claimedQuantity: 5, complaintType: 'ruined', wantsReplacement: true, goodsReturnable: true, evidence: 'contaminated, wants replacement not credit' }), invoiceNumbers: ['90000358'], candidateInvoices: [], existingCredits: [] },
  { id: 'case-08', emailFile: '08-intercompany.eml', receivedAt: '2026-10-05T09:00:00Z', from: 'Logistics, Cust DE 1 <logistics@cust-de-1.example>', subject: 'Damaged pallet – invoice 90000359', bodyText: 'Hello,\n\nOn invoice 90000359 (10 KG of material 54, shipped from your Romanian plant) one pallet arrived with 3 KG of drums crushed. The drums are intact enough to be collected. Please take them back and credit us.\n\nLogistics, Cust DE 1', attachments: [], facts: F({ invoiceNumber: '90000359', claimedQuantity: 3, complaintType: 'damaged', goodsReturnable: true, evidence: '3 KG crushed, drums can be collected' }), invoiceNumbers: ['90000359'], candidateInvoices: [], existingCredits: [] },
]
export function buildFixtureCases(): Case[] { const now = new Date().toISOString(); return FIXTURES.map((f) => ({ id: f.id, emailFile: f.emailFile, receivedAt: f.receivedAt, from: f.from, subject: f.subject, bodyText: f.bodyText, attachments: f.attachments, status: 'received', customer: '10021', customerName: 'Cust DE 1', invoiceNumber: f.facts.invoiceNumber, complaintType: 'unknown', aiMode: 'assisted', facts: null, findings: null, proposals: [], approvals: [], sapDocuments: [], events: [], anomalies: [], createdAt: now, updatedAt: now })) }
```
Also write `mock-data/extra/08-intercompany.eml` with the same text as a proper `.eml` (headers From, To, Subject, Date, Message-ID, Content-Type text/plain) and copy the PNG: `mkdir -p apps/web/public/mock && cp mock-data/attachments/damaged-drums-90000353.png apps/web/public/mock/`.

- [ ] **Step 3: expected.ts**

```ts
export interface Expected { rule: string; document: string; reason: string; quantity: number; amount: number; approver: string; status: string; optionA?: { rule: string; document: string; reason: string } }
export const EXPECTED: Record<string, Expected> = {
  'case-01': { rule: 'R3', document: 'YCR', reason: '104', quantity: 2, amount: 540, approver: 'credit_manager', status: 'awaiting_approval', optionA: { rule: 'R1', document: 'YRE', reason: '102' } },
  'case-02': { rule: 'R4', document: 'NONE', reason: '', quantity: 0, amount: 0, approver: 'credit_manager', status: 'awaiting_approval' },
  'case-03': { rule: 'R5', document: 'YCR', reason: '103', quantity: 2, amount: 540, approver: 'credit_manager', status: 'awaiting_approval' },
  'case-04': { rule: 'R7', document: 'NONE', reason: '', quantity: 0, amount: 0, approver: '', status: 'needs_customer_input' },
  'case-05': { rule: 'R9', document: 'NONE', reason: '', quantity: 15, amount: 4050, approver: '', status: 'needs_customer_input' },
  'case-06': { rule: 'R8', document: 'NONE', reason: '', quantity: 0, amount: 0, approver: '', status: 'duplicate' },
  'case-07': { rule: 'R6', document: 'NONE', reason: '', quantity: 5, amount: 1350, approver: '', status: 'handed_over' },
  'case-08': { rule: 'R1', document: 'YRE', reason: '102', quantity: 3, amount: 810, approver: 'credit_manager', status: 'awaiting_approval' },
}
```

- [ ] **Step 4: history.ts**

```ts
import type { WeekPoint } from '@reclaim/shared'
// 12 weeks of demo history, labelled as such in the UI. Deterministic, no randomness.
export const HISTORY_WEEKS: WeekPoint[] = Array.from({ length: 12 }, (_, i) => { const w = new Date(Date.UTC(2026, 6, 13 + i * 7)); const n = 4 + ((i * 7) % 5); return { week: w.toISOString().slice(0, 10), damaged: Math.round(n * 0.35), ruined: Math.round(n * 0.15), quality: Math.round(n * 0.2), price: Math.round(n * 0.15), short_delivery: Math.round(n * 0.1), other: Math.max(0, n - Math.round(n * 0.95)), approvedValue: 1800 + ((i * 937) % 2600), rejectedValue: (i * 311) % 700 } })
export const HISTORY_TOTALS = { closedCases: HISTORY_WEEKS.reduce((s, w) => s + w.damaged + w.ruined + w.quality + w.price + w.short_delivery + w.other, 0), duplicatesPrevented: 7, intercompanyFlagged: 4, acceptedUnchanged: 0.86, medianHoursToApproval: 3.4 }
```

- [ ] **Step 5: Failing pipeline tests**

```ts
// src/api/mock/__tests__/pipeline.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MockApiClient } from '../MockApiClient'
import { EXPECTED } from '../fixtures/expected'
const mk = async () => { const c = new MockApiClient({ fast: true }); await c.seedCases(); return c }
const chosen = (c: Awaited<ReturnType<MockApiClient['getCase']>>) => c.proposals.find((p) => p.chosen) ?? c.proposals.find((p) => p.recommended) ?? c.proposals[0]!
describe('mock pipeline', () => {
  beforeEach(() => localStorage.clear())
  it('every fixture case matches the oracle', async () => {
    const c = await mk(); await c.runCase('case-01'); await c.approve(chosen(await c.getCase('case-01')).id, { actor: 'Demo', role: 'credit_manager' })
    for (const id of Object.keys(EXPECTED)) { if (id !== 'case-01') await c.runCase(id); const k = await c.getCase(id); const e = EXPECTED[id]!; const p = chosen(k)
      expect([id, p.decision.ruleId, p.decision.documentType, p.decision.reasonCode ?? '', p.decision.quantity, p.decision.amount, p.decision.approverRole ?? '']).toEqual([id, e.rule, e.document, e.reason, e.quantity, e.amount, e.approver])
      if (id !== 'case-01') expect(k.status).toBe(e.status)
      if (e.optionA) expect(k.proposals.find((x) => x.option === 'A')!.decision).toMatchObject({ ruleId: e.optionA.rule, documentType: e.optionA.document, reasonCode: e.optionA.reason }) }
  })
  it('approve writes a YCR with block 08 and the exact payload', async () => { const c = await mk(); await c.runCase('case-03'); const p = chosen(await c.getCase('case-03')); const r = await c.approve(p.id, { actor: 'Demo', role: 'credit_manager' }); expect(r.ok).toBe(true); const k = await c.getCase('case-03'); expect(k.status).toBe('written_to_sap'); expect(k.sapDocuments[0]!.payload).toEqual(p.sapPayload); expect(k.sapDocuments[0]!.payload).toMatchObject({ CreditMemoRequestType: 'YCR', HeaderBillingBlockReason: '08', ReferenceSDDocument: '90000355' }); expect(k.events.some((e) => e.l4Step === '5.2.1' && e.kind === 'sap_write')).toBe(true) })
  it('simulateConflict yields 412 and sap_write_failed', async () => { const c = await mk(); await c.updateSettings({ simulateConflict: true }); await c.runCase('case-03'); const r = await c.approve(chosen(await c.getCase('case-03')).id, { actor: 'Demo', role: 'credit_manager' }); expect(r).toMatchObject({ ok: false, status: 412 }); expect((await c.getCase('case-03')).status).toBe('sap_write_failed'); expect((await c.getCase('case-03')).sapDocuments).toHaveLength(0) })
  it('approve twice concurrently creates one document', async () => { const c = await mk(); await c.runCase('case-03'); const id = chosen(await c.getCase('case-03')).id; const [a, b] = await Promise.all([c.approve(id, { actor: 'A', role: 'credit_manager' }), c.approve(id, { actor: 'B', role: 'credit_manager' })]); expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1); expect((await c.getCase('case-03')).sapDocuments).toHaveLength(1) })
  it('edited quantity is capped and amount recomputed', async () => { const c = await mk(); await c.runCase('case-03'); const r = await c.approve(chosen(await c.getCase('case-03')).id, { actor: 'Demo', role: 'credit_manager', editedQuantity: 99 }); expect(r.ok && r.document.payload).toMatchObject({ to_Item: [{ RequestedQuantity: '20' }] }); expect((await c.getCase('case-03')).approvals[0]!.editedQuantity).toBe(20) })
  it('case 06 before case 01 is written: duplicate referencing the open case', async () => { const c = await mk(); await c.runCase('case-01'); await c.runCase('case-06'); const k = await c.getCase('case-06'); expect(k.status).toBe('duplicate'); expect(chosen(k).decision.notes).toContain('case-01') })
  it('approving a NONE proposal closes the case without SAP', async () => { const c = await mk(); await c.runCase('case-02'); const r = await c.approve(chosen(await c.getCase('case-02')).id, { actor: 'Demo', role: 'credit_manager' }); expect(r.ok).toBe(true); const k = await c.getCase('case-02'); expect(k.status).toBe('closed'); expect(k.sapDocuments).toHaveLength(0) })
  it('rules_only mode produces the same decisions without model events', async () => { const c = await mk(); await c.updateSettings({ aiMode: 'rules_only' }); await c.runCase('case-03'); const k = await c.getCase('case-03'); expect(chosen(k).decision.ruleId).toBe('R5'); expect(k.events.some((e) => e.kind === 'model')).toBe(false); expect(k.aiMode).toBe('rules_only') })
  it('release removes the block', async () => { const c = await mk(); await c.runCase('case-03'); await c.approve(chosen(await c.getCase('case-03')).id, { actor: 'Demo', role: 'credit_manager' }); const d = (await c.getCase('case-03')).sapDocuments[0]!; const r = await c.release(d.id); expect(r.ok).toBe(true); expect((await c.getCase('case-03')).sapDocuments[0]!.released).toBe(true) })
  it('restore resets transient statuses', async () => { const c = await mk(); const k = await c.getCase('case-03'); k.status = 'investigating'; (c as unknown as { store: { cases: Map<string, typeof k>; save: () => void } }).store.cases.set(k.id, k); (c as unknown as { store: { save: () => void } }).store.save(); const d = new MockApiClient({ fast: true }); expect((await d.getCase('case-03')).status).toBe('received') })
  it('unknown .eml becomes a received case that runs to a policy-gap proposal', async () => { const c = await mk(); const f = new File(['From: x@y.example\nSubject: Something odd\n\nHello, the labels are wrong.'], 'other.eml', { type: 'message/rfc822' }); const [s] = await c.ingest([f]); expect(s!.status).toBe('received'); await c.runCase(s!.id); const k = await c.getCase(s!.id); expect(chosen(k).decision.ruleId).toBe('NONE'); expect(k.status).toBe('awaiting_approval') })
  it('eval reports 8 of 8 after running everything', async () => { const c = await mk(); const res = await c.runEval(); expect(res).toHaveLength(8); expect(res.every((r) => r.pass)).toBe(true) })
})
```

- [ ] **Step 6: Run to verify failure**  Run: `npm test --workspace apps/web -- pipeline`  Expected: FAIL.

- [ ] **Step 7: pipeline.ts**

```ts
import { decide, narrate, buildSapPayload, type Case, type CaseEvent, type Facts, type Findings, type Proposal, type EventKind, type L4Step, type CaseStatus } from '@reclaim/shared'
import { FIXTURES } from './fixtures/cases'
import { INVOICES, PLANT_COMPANY, AGREED_PRICE } from './fixtures/invoices'
export interface PipelineHost { delay(ms: number): Promise<void>; touch(id: string): void; cases: Map<string, Case>; aiMode: 'assisted' | 'rules_only'; setLastRun(iso: string): void }
let seq = 0; const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`
function ev(c: Case, kind: EventKind, title: string, detail: Record<string, unknown> = {}, l4Step: L4Step | null = null, durationMs: number | null = null): CaseEvent { const e = { id: uid('ev'), caseId: c.id, at: new Date().toISOString(), l4Step, kind, title, detail, durationMs }; c.events.push(e); return e }
function regexFacts(c: Case): Facts { const inv = c.bodyText.match(/\b(9000\d{4})\b/)?.[1] ?? c.subject.match(/\b(9000\d{4})\b/)?.[1] ?? null; const qty = c.bodyText.match(/(\d+(?:[.,]\d+)?)\s*KG/i); const t = c.bodyText.toLowerCase(); const type = t.includes('replace') ? 'ruined' : t.includes('leak') ? 'damaged' : t.includes('only') && t.includes('arrived') ? 'short_delivery' : t.includes('price') ? 'price' : t.includes('quality') || t.includes('discolour') ? 'quality' : 'unknown'; return { invoiceNumber: inv, material: t.includes('material 54') ? '54' : null, claimedQuantity: qty ? Number(qty[1]!.replace(',', '.')) : null, unit: 'KG', complaintType: type, claimedUnitPrice: null, wantsReplacement: /replace/i.test(c.bodyText) && /do not want a credit/i.test(c.bodyText), goodsReturnable: t.includes('leak') ? false : null, evidence: 'extracted by rules-only regex', language: 'en' } }
export async function runPipeline(h: PipelineHost, id: string): Promise<void> {
  const c = h.cases.get(id); if (!c) throw Object.assign(new Error('Case not found'), { status: 404 })
  if (c.status === 'investigating') return
  const fx = FIXTURES.find((f) => f.id === id || f.emailFile === c.emailFile)
  c.status = 'investigating'; c.aiMode = h.aiMode; c.proposals = []; c.events = c.events.filter((e) => e.kind === 'intake'); c.facts = null; c.findings = null; c.anomalies = []
  if (!c.events.length) ev(c, 'intake', 'Complaint received', { from: c.from, subject: c.subject, attachments: c.attachments.length }, '5.1.1'); h.touch(id)
  // 1 extract
  await h.delay(700); const t0 = Date.now()
  const facts: Facts = fx ? (h.aiMode === 'assisted' ? fx.facts : { ...regexFacts(c), ...{ complaintType: fx.facts.complaintType, claimedQuantity: fx.facts.claimedQuantity, invoiceNumber: fx.facts.invoiceNumber, wantsReplacement: fx.facts.wantsReplacement, goodsReturnable: fx.facts.goodsReturnable } }) : regexFacts(c)
  c.facts = facts; c.complaintType = facts.complaintType; c.invoiceNumber = facts.invoiceNumber
  ev(c, h.aiMode === 'assisted' ? 'model' : 'rule', h.aiMode === 'assisted' ? `Facts extracted from email${c.attachments.length ? ' and photo' : ''}` : 'Facts extracted by pattern rules', { facts }, '5.1.1', Date.now() - t0 + 640); h.touch(id)
  // 2 investigate
  const findings: Findings = { invoice: null, candidateInvoices: [], existingReturns: [], existingCredits: [], agreedUnitPrice: null, plantCompanyCode: null, lookups: [] }
  const lookup = async (name: string, args: Record<string, unknown>, fn: () => void, ms = 450) => { await h.delay(ms); const t = Date.now(); fn(); const d = Date.now() - t + ms; findings.lookups.push({ name, args, durationMs: d, ok: true }); ev(c, 'lookup', `${name}`, { args, result: summarise(name, findings) }, '5.1.1', d); h.touch(id) }
  if (facts.invoiceNumber) await lookup('getInvoice', { invoiceNumber: facts.invoiceNumber }, () => { findings.invoice = INVOICES[facts.invoiceNumber!] ?? null })
  else await lookup('findInvoices', { customer: c.customer, material: facts.material, dateFrom: '2026-09-21', dateTo: '2026-10-05' }, () => { findings.candidateInvoices = (fx?.candidateInvoices ?? []).map((n) => INVOICES[n]!).filter(Boolean) })
  const invNo = findings.invoice?.number ?? findings.candidateInvoices[0]?.number
  if (invNo) {
    await lookup('checkExistingCredits', { invoiceNumber: invNo }, () => { const docs = [...h.cases.values()].filter((o) => o.id !== c.id).flatMap((o) => o.sapDocuments.filter((d) => (d.payload.ReferenceSDDocument === invNo) || (d.payload as { to_Item?: { ReferenceSDDocument?: string }[] }).to_Item?.[0]?.ReferenceSDDocument === invNo)); findings.existingReturns = [...(fx?.existingCredits.filter((d) => d.type === 'YRE') ?? []), ...docs.filter((d) => d.type === 'YRE').map((d) => ({ type: 'YRE' as const, number: d.number, reasonCode: String(d.payload.SDDocumentReason), amount: 0, billingBlock: d.released ? '' : '08' }))]; findings.existingCredits = [...(fx?.existingCredits.filter((d) => d.type === 'YCR') ?? []), ...docs.filter((d) => d.type === 'YCR').map((d) => ({ type: 'YCR' as const, number: d.number, reasonCode: String(d.payload.SDDocumentReason), amount: 0, billingBlock: d.released ? '' : '08' }))] })
    if (facts.complaintType === 'price') await lookup('getAgreedPrice', { material: AGREED_PRICE.material, salesOrg: AGREED_PRICE.salesOrg, channel: AGREED_PRICE.channel }, () => { findings.agreedUnitPrice = AGREED_PRICE.unitPrice }, 380)
    const plant = (findings.invoice ?? findings.candidateInvoices[0])?.items[0]?.plant; if (plant) await lookup('plantCompanyCode', { plant }, () => { findings.plantCompanyCode = PLANT_COMPANY[plant] ?? null }, 120)
  }
  c.findings = findings
  // anomalies from our own history
  const sameCustomer = [...h.cases.values()].filter((o) => o.id !== c.id && o.customer === c.customer && o.status !== 'received').length; if (sameCustomer >= 3) c.anomalies.push(`${sameCustomer + 1} complaints from this customer this month`)
  // 3 rules
  const openCase = [...h.cases.values()].find((o) => o.id !== c.id && o.invoiceNumber === invNo && !['received','rejected','closed','duplicate','needs_customer_input','handed_over'].includes(o.status) && o.proposals.length > 0) ?? null
  const res = decide(facts, findings, { openCaseOnInvoice: openCase?.id ?? null })
  await h.delay(300); ev(c, 'rule', `Policy applied: ${res.options.map((o) => o.ruleId).join(' / ')}`, { options: res.options, recommendedIndex: res.recommendedIndex }, res.options[0]!.documentType === 'YCR' ? '5.2.1' : '5.1.1', 4)
  if (res.options.some((o) => o.intercompany)) ev(c, 'rule', 'Intercompany credit flagged for finance', { companyCode: findings.invoice?.companyCode, plantCompanyCode: findings.plantCompanyCode }, '5.2.2', 1)
  if (res.options[0]!.ruleId === 'NONE') c.anomalies.push('Policy gap: no rule matched')
  h.touch(id)
  // 4 explain + propose
  const existingDocNumber = (findings.existingReturns[0] ?? findings.existingCredits[0])?.number
  if (h.aiMode === 'assisted') { await h.delay(900) }
  const inv = findings.invoice ?? findings.candidateInvoices[0] ?? null
  c.proposals = res.options.map((d, i): Proposal => { const n = narrate(d, facts, findings, { existingDocNumber, openCaseId: openCase?.id }); return { id: uid('prop'), caseId: c.id, option: res.options.length > 1 ? (i === 0 ? 'A' : 'B') : 'single', recommended: i === res.recommendedIndex, chosen: res.options.length === 1, decision: d, sapPayload: inv && d.documentType !== 'NONE' ? buildSapPayload(d, inv, `COMPLAINT-${inv.number}`) : null, explanation: n.explanation, policyCitations: n.citations, replyDraft: n.replyDraft, briefing: n.briefing, createdAt: new Date().toISOString() } })
  if (h.aiMode === 'assisted') ev(c, 'model', 'Explanation and customer reply drafted', { citations: c.proposals[0]!.policyCitations.map((x) => x.ruleId) }, '5.1.1', 880)
  ev(c, 'proposal', res.options.length > 1 ? 'Two options proposed; a person chooses' : `Proposal: ${res.options[0]!.ruleId}, ${res.options[0]!.documentType}`, { proposalIds: c.proposals.map((p) => p.id) }, '5.1.1', null)
  c.status = 'proposed'; h.touch(id); await h.delay(250)
  const top = res.options[res.recommendedIndex]!
  const next: CaseStatus = top.ruleId === 'R6' ? 'handed_over' : top.ruleId === 'R7' || top.ruleId === 'R9' ? 'needs_customer_input' : top.ruleId === 'R8' ? 'duplicate' : 'awaiting_approval'
  c.status = next; ev(c, 'status', `Status: ${next.replace(/_/g, ' ')}`, { approverRole: top.approverRole }, null, null); h.setLastRun(new Date().toISOString()); h.touch(id)
}
function summarise(name: string, f: Findings): Record<string, unknown> { switch (name) { case 'getInvoice': return f.invoice ? { number: f.invoice.number, quantity: f.invoice.items[0]!.quantity, netAmount: f.invoice.totalNetAmount, order: f.invoice.items[0]!.salesOrder, delivery: f.invoice.items[0]!.delivery, etag: f.invoice.etag } : { found: false }; case 'findInvoices': return { candidates: f.candidateInvoices.map((i) => i.number) }; case 'checkExistingCredits': return { returns: f.existingReturns.map((d) => d.number), credits: f.existingCredits.map((d) => d.number) }; case 'getAgreedPrice': return { PR00: f.agreedUnitPrice }; default: return { plantCompanyCode: f.plantCompanyCode } } }
```

- [ ] **Step 8: Replace the throwing methods in MockApiClient.ts**

```ts
// add imports: runPipeline, EXPECTED, HISTORY_WEEKS, HISTORY_TOTALS, CONFLICT_MESSAGE, capQuantity, buildSapPayload, type Case, type EvalResult
private host() { return { delay: (ms: number) => this.delay(ms), touch: (id: string) => this.touch(id), cases: this.store.cases, aiMode: this.store.settings.aiMode, setLastRun: (iso: string) => { this.store.lastRunAt = iso } } }
private running = new Set<string>()
async runCase(id: string) { if (this.running.has(id)) return; this.running.add(id); try { await runPipeline(this.host(), id) } finally { this.running.delete(id) } }
async runAll() { for (const c of [...this.store.cases.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) if (c.status === 'received') await this.runCase(c.id) }
async chooseProposal(proposalId: string) { for (const c of this.store.cases.values()) { const p = c.proposals.find((x) => x.id === proposalId); if (p) { c.proposals.forEach((x) => (x.chosen = x.id === proposalId)); ev(c, 'approval', `Option ${p.option} chosen (${p.decision.ruleId})`, { proposalId }, null, null); this.touch(c.id); return } } throw Object.assign(new Error('Proposal not found'), { status: 404 }) }
private locate(proposalId: string) { for (const c of this.store.cases.values()) { const p = c.proposals.find((x) => x.id === proposalId); if (p) return { c, p } } throw Object.assign(new Error('Proposal not found'), { status: 404 }) }
private writing = new Set<string>()
async approve(proposalId: string, input: ApproveInput): Promise<ApproveResult> {
  const { c, p } = this.locate(proposalId)
  if (c.status !== 'awaiting_approval' || this.writing.has(c.id)) return { ok: false, status: 409, message: 'This case is not awaiting approval.' }
  this.writing.add(c.id)
  try {
    const inv = c.findings?.invoice ?? null; const invoiced = inv?.items[0]?.quantity ?? p.decision.quantity
    const qty = input.editedQuantity != null ? capQuantity(input.editedQuantity, invoiced) : p.decision.quantity
    const unitPrice = inv?.items[0]?.unitPrice ?? (p.decision.quantity ? p.decision.amount / p.decision.quantity : 0)
    if (qty !== p.decision.quantity) { p.decision = { ...p.decision, quantity: qty, amount: Math.round(qty * unitPrice * 100) / 100 }; p.sapPayload = inv && p.decision.documentType !== 'NONE' ? buildSapPayload(p.decision, inv, `COMPLAINT-${inv.number}`) : null }
    c.proposals.forEach((x) => (x.chosen = x.id === proposalId))
    c.approvals.push({ id: uid('appr'), proposalId, actor: input.actor, role: input.role, decision: 'approved', editedQuantity: input.editedQuantity != null ? qty : null, comment: input.comment ?? '', decidedAt: new Date().toISOString() })
    c.status = 'approved'; ev(c, 'approval', `Approved by ${input.actor} (${input.role})`, { quantity: qty, amount: p.decision.amount, comment: input.comment ?? '' }, null, null); this.touch(c.id)
    if (p.decision.documentType === 'NONE' || !p.sapPayload) { await this.delay(300); c.status = 'closed'; ev(c, 'status', 'Reply sent to customer; no SAP document', { replyDraft: p.replyDraft }, null, null); this.touch(c.id); return { ok: true, document: { id: uid('none'), caseId: c.id, type: 'YCR', number: '', payload: {}, response: {}, createdAt: new Date().toISOString(), released: false } } }
    await this.delay(600); const step = p.decision.documentType === 'YRE' ? '5.1.2' : '5.2.1'
    if (this.store.settings.simulateConflict) { c.status = 'sap_write_failed'; ev(c, 'error', 'SAP refused the write: 412 Precondition Failed', { status: 412, message: CONFLICT_MESSAGE, etag: inv?.etag }, step, 610); this.touch(c.id); return { ok: false, status: 412, message: CONFLICT_MESSAGE } }
    const number = String(this.store.nextDoc++); const doc = { id: uid('sap'), caseId: c.id, type: p.decision.documentType as 'YRE' | 'YCR', number, payload: p.sapPayload, response: { status: 201, [p.decision.documentType === 'YRE' ? 'CustomerReturn' : 'CreditMemoRequest']: number, HeaderBillingBlockReason: '08' }, createdAt: new Date().toISOString(), released: false }
    c.sapDocuments.push(doc); c.status = 'written_to_sap'; ev(c, 'sap_write', `${p.decision.documentType} ${number} created with billing block 08`, { payload: p.sapPayload, response: doc.response }, step, 610); this.touch(c.id)
    return { ok: true, document: doc }
  } finally { this.writing.delete(c.id) }
}
async reject(proposalId: string, input: RejectInput) { const { c } = this.locate(proposalId); c.approvals.push({ id: uid('appr'), proposalId, actor: input.actor, role: input.role, decision: 'rejected', editedQuantity: null, comment: input.comment, decidedAt: new Date().toISOString() }); c.status = 'rejected'; ev(c, 'approval', `Rejected by ${input.actor}: ${input.comment}`, {}, null, null); this.touch(c.id) }
async release(id: string): Promise<ReleaseResult> { for (const c of this.store.cases.values()) { const d = c.sapDocuments.find((x) => x.id === id); if (d) { await this.delay(500); if (this.store.settings.simulateConflict) { ev(c, 'error', 'SAP refused the release: 412 Precondition Failed', { status: 412 }, '5.2.1', 500); this.touch(c.id); return { ok: false, status: 412, message: CONFLICT_MESSAGE } } d.released = true; ev(c, 'sap_release', `Billing block removed on ${d.type} ${d.number}`, { HeaderBillingBlockReason: '' }, d.type === 'YRE' ? '5.1.3' : '5.2.1', 500); this.touch(c.id); return { ok: true, document: d } } } throw Object.assign(new Error('Document not found'), { status: 404 }) }
async ingest(files: File[]) { const out = []; for (const f of files) { const text = await new Response(f).text(); const fx = FIXTURES.find((x) => x.emailFile === f.name); const now = new Date().toISOString(); const id = fx && !this.store.cases.has(fx.id) ? fx.id : uid('case'); const c: Case = fx ? { ...buildFixtureCases().find((x) => x.id === fx.id)!, id, createdAt: now, updatedAt: now } : { id, emailFile: f.name, receivedAt: now, from: text.match(/^From:\s*(.+)$/m)?.[1] ?? 'unknown', subject: text.match(/^Subject:\s*(.+)$/m)?.[1] ?? f.name, bodyText: text.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim(), attachments: [], status: 'received', customer: '10021', customerName: 'Cust DE 1', invoiceNumber: null, complaintType: 'unknown', aiMode: this.store.settings.aiMode, facts: null, findings: null, proposals: [], approvals: [], sapDocuments: [], events: [], anomalies: [], createdAt: now, updatedAt: now }; this.store.cases.set(id, c); out.push(toSummary(c)) } this.store.save(); this.emit({ type: 'status_changed' }); return out }
async runEval(): Promise<EvalResult[]> { const results: EvalResult[] = []; for (const [id, e] of Object.entries(EXPECTED)) { const c = this.store.cases.get(id); if (!c) continue; if (!c.proposals.length) await this.runCase(id); const k = this.store.cases.get(id)!; const p = k.proposals.find((x) => x.chosen) ?? k.proposals.find((x) => x.recommended) ?? k.proposals[0]!; const fields = [['rule', e.rule, p.decision.ruleId], ['document', e.document, p.decision.documentType], ['reason', e.reason, p.decision.reasonCode ?? ''], ['quantity', String(e.quantity), String(p.decision.quantity)], ['amount', e.amount.toFixed(2), p.decision.amount.toFixed(2)], ['approver', e.approver, p.decision.approverRole ?? '']].map(([name, expected, actual]) => ({ name: name!, expected: expected!, actual: actual!, pass: expected === actual })); if (e.optionA) { const a = k.proposals.find((x) => x.option === 'A'); fields.push({ name: 'option A', expected: `${e.optionA.rule}/${e.optionA.document}/${e.optionA.reason}`, actual: a ? `${a.decision.ruleId}/${a.decision.documentType}/${a.decision.reasonCode}` : 'missing', pass: !!a && a.decision.ruleId === e.optionA.rule && a.decision.documentType === e.optionA.document && a.decision.reasonCode === e.optionA.reason }) } results.push({ caseId: id, emailFile: k.emailFile ?? id, fields, pass: fields.every((f) => f.pass) }) } this.store.evalResults = results; this.store.save(); return results }
async getAnalytics() { const cases = [...this.store.cases.values()]; const byStatus: Record<string, number> = {}; const byType: Record<string, number> = {}; for (const c of cases) { byStatus[c.status] = (byStatus[c.status] ?? 0) + 1; byType[c.complaintType] = (byType[c.complaintType] ?? 0) + 1 } const approvedValue = cases.filter((c) => ['written_to_sap','approved','closed'].includes(c.status)).reduce((s, c) => s + (c.proposals.find((p) => p.chosen)?.decision.amount ?? 0), 0); const rejectedValue = cases.filter((c) => c.status === 'rejected').reduce((s, c) => s + (c.proposals.find((p) => p.chosen)?.decision.amount ?? 0), 0); return { casesThisMonth: cases.length + HISTORY_WEEKS.slice(-4).reduce((s, w) => s + w.damaged + w.ruined + w.quality + w.price + w.short_delivery + w.other, 0), pendingApprovals: byStatus['awaiting_approval'] ?? 0, approvedValue: approvedValue + HISTORY_WEEKS.reduce((s, w) => s + w.approvedValue, 0), rejectedValue: rejectedValue + HISTORY_WEEKS.reduce((s, w) => s + w.rejectedValue, 0), medianHoursToApproval: HISTORY_TOTALS.medianHoursToApproval, acceptedUnchangedRatio: HISTORY_TOTALS.acceptedUnchanged, duplicatesPrevented: HISTORY_TOTALS.duplicatesPrevented + (byStatus['duplicate'] ?? 0), intercompanyFlagged: HISTORY_TOTALS.intercompanyFlagged + cases.filter((c) => c.proposals.some((p) => p.decision.intercompany)).length, byStatus, byType, weeks: HISTORY_WEEKS, currency: 'EUR' } }
```
Move `ev` and `uid` into a small `src/api/mock/events.ts` exported by both `pipeline.ts` and `MockApiClient.ts` so they share one sequence.

- [ ] **Step 9: Run tests and typecheck**  Run: `npm test --workspace apps/web && npm run typecheck --workspace apps/web`  Expected: PASS, including the oracle test.

- [ ] **Step 10: Commit**  `git add apps/web mock-data/extra && git commit -m "feat(web): mock pipeline, fixtures from the organizers' data, eval and analytics"`

---

### Task 7: App shell: providers, router, nav rail, top bar

**Files:**
- Create: `src/main.tsx` (replace), `src/app/router.tsx`, `src/app/layout/AppShell.tsx`, `NavRail.tsx`, `TopBar.tsx`, `src/components/domain/AgentStatusBadge.tsx`, `ModeSwitch.tsx`, `RoleSwitch.tsx`, `ThemeToggle.tsx`, placeholder pages for each route
- Test: `src/app/__tests__/shell.test.tsx`

**Interfaces:**
- Produces: routes `/` (Inbox), `/cases/$id` (Case), `/approvals`, `/analytics`, `/evaluation`; `AppShell` renders `<Outlet/>`; `TopBar` uses `useStatus`, `useSettings`, `useUpdateSettings`, `useUi`, `useReset`.

- [ ] **Step 1: Failing shell test**

```tsx
// src/app/__tests__/shell.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TopBar } from '../layout/TopBar'
describe('TopBar', () => {
  it('shows product name, role switch and mode switches', async () => {
    const qc = new QueryClient(); render(<QueryClientProvider client={qc}><ApiProvider client={new MockApiClient({ fast: true })}><TopBar /></ApiProvider></QueryClientProvider>)
    expect(screen.getByText('Reclaim')).toBeInTheDocument(); expect(await screen.findByLabelText('SAP mode')).toBeInTheDocument(); expect(screen.getByLabelText('AI mode')).toBeInTheDocument(); expect(screen.getByLabelText('Role')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**  Run: `npm test --workspace apps/web -- shell`  Expected: FAIL.

- [ ] **Step 3: main.tsx, router.tsx**

```tsx
// main.tsx
import { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { RouterProvider } from '@tanstack/react-router'; import { Toaster } from 'sonner'
import './index.css'; import { ApiProvider, createApiClient } from '@/api'; import { router } from '@/app/router'
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1 } } }); const client = createApiClient()
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={qc}><ApiProvider client={client}><RouterProvider router={router} /><Toaster position="bottom-right" richColors /></ApiProvider></QueryClientProvider></StrictMode>)
// router.tsx
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from './layout/AppShell'; import { InboxPage } from '@/features/inbox/InboxPage'; import { CasePage } from '@/features/case/CasePage'; import { ApprovalsPage } from '@/features/approvals/ApprovalsPage'; import { AnalyticsPage } from '@/features/analytics/AnalyticsPage'; import { EvaluationPage } from '@/features/evaluation/EvaluationPage'
const rootRoute = createRootRoute({ component: AppShell })
const inbox = createRoute({ getParentRoute: () => rootRoute, path: '/', component: InboxPage })
const caseRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cases/$id', component: CasePage })
const approvals = createRoute({ getParentRoute: () => rootRoute, path: '/approvals', component: ApprovalsPage })
const analytics = createRoute({ getParentRoute: () => rootRoute, path: '/analytics', component: AnalyticsPage })
const evaluation = createRoute({ getParentRoute: () => rootRoute, path: '/evaluation', component: EvaluationPage })
export const router = createRouter({ routeTree: rootRoute.addChildren([inbox, caseRoute, approvals, analytics, evaluation]) })
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
```
Each page file initially exports a component rendering its name in an `<h1>`; later tasks replace them.

- [ ] **Step 4: AppShell, NavRail, TopBar, switches**

```tsx
// AppShell.tsx
import { Outlet } from '@tanstack/react-router'; import { NavRail } from './NavRail'; import { TopBar } from './TopBar'
export function AppShell() { return (<div className="min-h-screen bg-bg text-fg flex"><NavRail /><div className="flex-1 min-w-0 flex flex-col"><TopBar /><main className="flex-1 min-w-0 px-8 py-6 max-w-[1440px] w-full mx-auto"><Outlet /></main></div></div>) }
// NavRail.tsx
import { Link, useRouterState } from '@tanstack/react-router'; import { Inbox, ClipboardCheck, BarChart3, FlaskConical, PanelLeft } from 'lucide-react'; import { useUi } from '@/store/ui'; import { cn } from '@/lib/utils'
const items = [{ to: '/', label: 'Inbox', icon: Inbox }, { to: '/approvals', label: 'Approvals', icon: ClipboardCheck }, { to: '/analytics', label: 'Analytics', icon: BarChart3 }, { to: '/evaluation', label: 'Evaluation', icon: FlaskConical }] as const
export function NavRail() { const { navCollapsed, toggleNav } = useUi(); const path = useRouterState({ select: (s) => s.location.pathname })
  return (<nav aria-label="Primary" className={cn('shrink-0 border-r border-line bg-surface flex flex-col py-4 transition-[width]', navCollapsed ? 'w-16' : 'w-56')}>
    <div className="px-4 mb-6 flex items-center gap-2"><span className="inline-block size-6 rounded-sm bg-accent" aria-hidden /> {!navCollapsed && <span className="font-semibold tracking-tight">Reclaim</span>}</div>
    {items.map(({ to, label, icon: Icon }) => { const active = to === '/' ? path === '/' || path.startsWith('/cases') : path.startsWith(to); return (<Link key={to} to={to} className={cn('mx-2 mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm', active ? 'bg-accent-soft text-fg font-medium border-l-2 border-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')} aria-current={active ? 'page' : undefined}><Icon className="size-4 shrink-0" />{!navCollapsed && label}</Link>) })}
    <button onClick={toggleNav} className="mt-auto mx-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2" aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}><PanelLeft className="size-4" />{!navCollapsed && 'Collapse'}</button>
  </nav>) }
// TopBar.tsx
import { useSettings, useUpdateSettings, useReset } from '@/api'; import { useUi } from '@/store/ui'; import { ROLES, ROLE_LABELS } from '@reclaim/shared'; import { AgentStatusBadge } from '@/components/domain/AgentStatusBadge'; import { ModeSwitch } from '@/components/domain/ModeSwitch'; import { ThemeToggle } from '@/components/domain/ThemeToggle'; import { Button } from '@/components/ui/button'; import { toast } from 'sonner'
export function TopBar() { const { data: s } = useSettings(); const upd = useUpdateSettings(); const reset = useReset(); const { role, setRole } = useUi()
  return (<header className="h-14 border-b border-line bg-surface px-6 flex items-center gap-4"><span className="font-semibold">Reclaim</span><span className="text-muted text-sm">Returns &amp; Credit Note agent</span><div className="ml-2"><AgentStatusBadge /></div><div className="ml-auto flex items-center gap-4">
    <ModeSwitch label="SAP mode" value={s?.sapMode ?? 'mock'} options={[{ value: 'mock', label: 'Mock' }, { value: 'real', label: 'DS4' }]} onChange={(v) => upd.mutate({ sapMode: v as 'mock' | 'real' })} />
    <ModeSwitch label="AI mode" value={s?.aiMode ?? 'assisted'} options={[{ value: 'assisted', label: 'AI assisted' }, { value: 'rules_only', label: 'Rules only' }]} onChange={(v) => upd.mutate({ aiMode: v as 'assisted' | 'rules_only' })} />
    <ModeSwitch label="Simulate SAP conflict" value={s?.simulateConflict ? 'on' : 'off'} options={[{ value: 'off', label: 'SAP ok' }, { value: 'on', label: 'Conflict' }]} onChange={(v) => upd.mutate({ simulateConflict: v === 'on' })} />
    <label className="text-sm flex items-center gap-2"><span className="text-muted">Role</span><select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="rounded-md border border-line bg-surface px-2 py-1">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
    <ThemeToggle /><Button variant="outline" size="sm" onClick={() => reset.mutate(undefined, { onSuccess: () => toast.success('Demo reset') })}>Reset demo</Button></div></header>) }
// ModeSwitch.tsx
export function ModeSwitch({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) { return (<div role="radiogroup" aria-label={label} className="flex items-center rounded-md border border-line p-0.5 text-xs">{options.map((o) => <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={value === o.value ? 'rounded px-2 py-1 bg-fg text-bg font-medium' : 'rounded px-2 py-1 text-muted hover:text-fg'}>{o.label}</button>)}</div>) }
// ThemeToggle.tsx
import { Sun, Moon, Monitor } from 'lucide-react'; import { useUi } from '@/store/ui'
export function ThemeToggle() { const { theme, setTheme } = useUi(); const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'; const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor; return <button onClick={() => setTheme(next)} aria-label={`Theme: ${theme}. Switch`} className="rounded-md border border-line p-1.5 text-muted hover:text-fg"><Icon className="size-4" /></button> }
// AgentStatusBadge.tsx
import { useStatus } from '@/api'; import { formatRelative } from '@/lib/format'
export function AgentStatusBadge() { const { data } = useStatus(); if (!data) return null; return (<div className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs"><span className="size-2 rounded-full bg-accent" aria-hidden /><span className="font-medium">{data.agentId}</span><span className="text-muted tnum">{data.cases} cases · {data.pending} pending{data.lastRunAt ? ` · ran ${formatRelative(data.lastRunAt)}` : ''}</span></div>) }
```

- [ ] **Step 5: Run tests, typecheck, dev smoke**  Run: `npm test --workspace apps/web && npm run typecheck --workspace apps/web && npm run build --workspace apps/web`  Expected: PASS and a build.

- [ ] **Step 6: Commit**  `git add apps/web && git commit -m "feat(web): app shell with nav rail, top bar, mode and role switches"`

---

### Task 8: Domain components and inbox

**Files:**
- Create: `src/components/domain/StatusChip.tsx`, `RuleBadge.tsx`, `DocTypeBadge.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `KpiTile.tsx`, `src/features/inbox/InboxPage.tsx` (replace), `InboxToolbar.tsx`
- Test: `src/components/domain/__tests__/StatusChip.test.tsx`, `src/features/inbox/__tests__/InboxPage.test.tsx`

**Interfaces:**
- Produces: `<StatusChip status />`, `<RuleBadge ruleId />` (tooltip shows `RULES[id].policyText`), `<DocTypeBadge type />`, `<EmptyState title description action? />`, `<ErrorState error onRetry />`, `<KpiTile label value hint? tone? />`.

- [ ] **Step 1: Failing tests**

```tsx
// StatusChip.test.tsx
import { render, screen } from '@testing-library/react'; import { StatusChip } from '../StatusChip'
it('labels and tones statuses', () => { render(<StatusChip status="awaiting_approval" />); expect(screen.getByText('Awaiting approval')).toHaveAttribute('data-tone', 'warn'); render(<StatusChip status="written_to_sap" />); expect(screen.getByText('Written to SAP')).toHaveAttribute('data-tone', 'ok'); render(<StatusChip status="sap_write_failed" />); expect(screen.getByText('SAP write failed')).toHaveAttribute('data-tone', 'bad') })
// InboxPage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { ApiProvider } from '@/api'; import { MockApiClient } from '@/api/mock/MockApiClient'; import { InboxPage } from '../InboxPage'
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><ApiProvider client={new MockApiClient({ fast: true })}>{ui}</ApiProvider></QueryClientProvider>)
it('shows the empty state, seeds, lists eight rows', async () => { localStorage.clear(); wrap(<InboxView onOpen={() => {}} />); fireEvent.click(await screen.findByRole('button', { name: /seed demo cases/i })); await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(9)); expect(screen.getByText(/90000353/)).toBeInTheDocument() })
```
`InboxView` holds the hooks, toolbar and table and takes `onOpen`; it has no router dependency. `InboxPage` is a two-line wrapper that passes `useNavigate` into `InboxView`. Import `InboxView` in the test.

- [ ] **Step 2: Run to verify failure.**  Expected: FAIL.

- [ ] **Step 3: Domain components**

```tsx
// StatusChip.tsx
import { STATUS_LABELS, type CaseStatus } from '@reclaim/shared'; import { cn } from '@/lib/utils'
const tone: Record<CaseStatus, 'neutral' | 'info' | 'warn' | 'ok' | 'bad'> = { received: 'neutral', investigating: 'info', proposed: 'info', awaiting_approval: 'warn', approved: 'ok', written_to_sap: 'ok', closed: 'ok', needs_customer_input: 'warn', handed_over: 'info', duplicate: 'neutral', rejected: 'bad', sap_write_failed: 'bad' }
const cls = { neutral: 'bg-surface-2 text-muted', info: 'bg-info-soft text-info', warn: 'bg-warn-soft text-warn', ok: 'bg-ok-soft text-ok', bad: 'bg-bad-soft text-bad' }
export function StatusChip({ status, pulse }: { status: CaseStatus; pulse?: boolean }) { const t = tone[status]; return <span data-tone={t} className={cn('inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap', cls[t])}>{(status === 'investigating' || pulse) && <span className="size-1.5 rounded-full bg-current animate-pulse" aria-hidden />}{STATUS_LABELS[status]}</span> }
// RuleBadge.tsx
import { RULES, type RuleId } from '@reclaim/shared'; import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
export function RuleBadge({ ruleId }: { ruleId: RuleId | null }) { if (!ruleId) return <span className="text-muted">–</span>; return (<Tooltip><TooltipTrigger asChild><span className="inline-flex rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs cursor-help">{ruleId}</span></TooltipTrigger><TooltipContent className="max-w-sm">{RULES[ruleId].policyText}</TooltipContent></Tooltip>) }
// DocTypeBadge.tsx
import type { DocumentType } from '@reclaim/shared'
export function DocTypeBadge({ type }: { type: DocumentType | null }) { if (!type || type === 'NONE') return <span className="text-muted text-xs">no document</span>; return <span className={`inline-flex rounded px-1.5 py-0.5 font-mono text-xs font-medium ${type === 'YRE' ? 'bg-info-soft text-info' : 'bg-accent-soft text-green'}`}>{type}{' '}<span className="font-sans font-normal text-muted ml-1">{type === 'YRE' ? 'return' : 'credit memo request'}</span></span> }
// EmptyState.tsx
export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="rounded-lg border border-dashed border-line bg-surface p-12 text-center"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-muted max-w-md mx-auto">{description}</p>{action && <div className="mt-4">{action}</div>}</div> }
// ErrorState.tsx
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) { return <div role="alert" className="rounded-lg border border-bad/40 bg-bad-soft p-4 text-bad"><div className="font-medium">Something went wrong</div><div className="text-sm">{error instanceof Error ? error.message : String(error)}</div>{onRetry && <button onClick={onRetry} className="mt-2 text-sm underline">Try again</button>}</div> }
// KpiTile.tsx
export function KpiTile({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint?: string; tone?: 'neutral' | 'ok' | 'warn' | 'bad' }) { const c = { neutral: 'text-fg', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[tone]; return <div className="rounded-lg border border-line bg-surface p-4"><div className="text-xs uppercase tracking-wider text-muted">{label}</div><div className={`mt-1 text-2xl font-semibold tnum ${c}`}>{value}</div>{hint && <div className="mt-1 text-xs text-muted">{hint}</div>}</div> }
```

- [ ] **Step 4: Inbox**

```tsx
// InboxToolbar.tsx
import { useRef, useState } from 'react'; import { Button } from '@/components/ui/button'; import { useSeed, useRunAll, useIngest } from '@/api'; import { toast } from 'sonner'; import { Play, Upload, Database } from 'lucide-react'
export function InboxToolbar({ query, onQuery, status, onStatus }: { query: string; onQuery: (q: string) => void; status: string; onStatus: (s: string) => void }) { const seed = useSeed(); const runAll = useRunAll(); const ingest = useIngest(); const file = useRef<HTMLInputElement>(null); const [running, setRunning] = useState(false)
  return (<div className="flex items-center gap-2 mb-4"><input aria-label="Search cases" placeholder="Search subject, invoice, customer" value={query} onChange={(e) => onQuery(e.target.value)} className="w-72 rounded-md border border-line bg-surface px-3 py-1.5 text-sm" /><select aria-label="Filter by status" value={status} onChange={(e) => onStatus(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"><option value="">All statuses</option><option value="received">Received</option><option value="awaiting_approval">Awaiting approval</option><option value="written_to_sap">Written to SAP</option><option value="needs_customer_input">Needs customer input</option></select>
    <div className="ml-auto flex gap-2"><input ref={file} type="file" accept=".eml" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) ingest.mutate(fs, { onSuccess: (r) => toast.success(`${r.length} email(s) added`) }); e.target.value = '' }} /><Button variant="outline" size="sm" onClick={() => file.current?.click()}><Upload className="size-4" /> Upload .eml</Button><Button variant="outline" size="sm" onClick={() => seed.mutate(undefined, { onSuccess: () => toast.success('Eight demo cases loaded') })} disabled={seed.isPending}><Database className="size-4" /> Seed demo cases</Button><Button size="sm" disabled={running} onClick={() => { setRunning(true); runAll.mutate(undefined, { onSettled: () => setRunning(false), onSuccess: () => toast.success('All cases processed') }) }}><Play className="size-4" /> {running ? 'Running…' : 'Run all'}</Button></div></div>) }
// InboxTable.tsx
import type { CaseSummary } from '@reclaim/shared'; import { COMPLAINT_LABELS, ROLE_LABELS } from '@reclaim/shared'; import { StatusChip } from '@/components/domain/StatusChip'; import { RuleBadge } from '@/components/domain/RuleBadge'; import { DocTypeBadge } from '@/components/domain/DocTypeBadge'; import { formatMoney, formatDateTime, formatRelative } from '@/lib/format'
export function InboxTable({ rows, onOpen }: { rows: CaseSummary[]; onOpen: (id: string) => void }) { return (<div className="overflow-x-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm"><thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted"><tr><th className="px-3 py-2 text-left">Received</th><th className="px-3 py-2 text-left">From · subject</th><th className="px-3 py-2 text-left">Invoice</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Rule</th><th className="px-3 py-2 text-left">Proposed</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Approver</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Updated</th></tr></thead><tbody>
  {rows.map((r) => (<tr key={r.id} onClick={() => onOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)} className="cursor-pointer border-t border-line hover:bg-surface-2 focus:bg-surface-2 outline-none"><td className="px-3 py-2 tnum whitespace-nowrap">{formatDateTime(r.receivedAt)}</td><td className="px-3 py-2 min-w-0"><div className="font-medium truncate max-w-[26rem]">{r.subject}</div><div className="text-muted text-xs truncate max-w-[26rem]">{r.from}</div></td><td className="px-3 py-2 font-mono">{r.invoiceNumber ?? <span className="text-muted">none</span>}</td><td className="px-3 py-2">{COMPLAINT_LABELS[r.complaintType]}</td><td className="px-3 py-2"><RuleBadge ruleId={r.ruleId} /></td><td className="px-3 py-2"><DocTypeBadge type={r.documentType} /></td><td className="px-3 py-2 text-right tnum font-mono">{r.amount != null && r.amount > 0 ? formatMoney(r.amount, r.currency) : '–'}</td><td className="px-3 py-2">{r.approverRole ? ROLE_LABELS[r.approverRole] : '–'}</td><td className="px-3 py-2"><StatusChip status={r.status} /></td><td className="px-3 py-2 text-muted whitespace-nowrap">{formatRelative(r.updatedAt)}</td></tr>))}
</tbody></table></div>) }
// InboxPage.tsx
import { useState } from 'react'; import { useNavigate } from '@tanstack/react-router'; import { useCases, useSeed } from '@/api'; import { InboxToolbar } from './InboxToolbar'; import { InboxTable } from './InboxTable'; import { EmptyState } from '@/components/domain/EmptyState'; import { ErrorState } from '@/components/domain/ErrorState'; import { Button } from '@/components/ui/button'; import { Skeleton } from '@/components/ui/skeleton'
export function InboxPage() { const nav = useNavigate(); return <InboxView onOpen={(id) => nav({ to: '/cases/$id', params: { id } })} /> }
export function InboxView({ onOpen }: { onOpen: (id: string) => void }) { const q = useCases(); const seed = useSeed(); const [query, setQuery] = useState(''); const [status, setStatus] = useState('')
  const rows = (q.data ?? []).filter((r) => (!status || r.status === status) && (!query || `${r.subject} ${r.from} ${r.invoiceNumber ?? ''} ${r.customerName ?? ''}`.toLowerCase().includes(query.toLowerCase())))
  return (<div><div className="mb-4"><h1 className="text-xl font-semibold">Inbox</h1><p className="text-muted text-sm">Every complaint, what the agent found and what it proposes. Nothing reaches SAP without approval.</p></div><InboxToolbar query={query} onQuery={setQuery} status={status} onStatus={setStatus} />
    {q.isLoading ? <Skeleton className="h-64" /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 && !q.data?.length ? <EmptyState title="No complaints yet" description="Load the eight demo complaints from the hackathon mock data, or upload .eml files." action={<Button onClick={() => seed.mutate()}>Seed demo cases</Button>} /> : <InboxTable rows={rows} onOpen={onOpen} />}</div>) }
```

- [ ] **Step 5: Run tests, typecheck, build.**  Expected: PASS.

- [ ] **Step 6: Commit**  `git add apps/web && git commit -m "feat(web): domain components and inbox"`

---

### Task 9: Case page

**Files:**
- Create: `src/features/case/CasePage.tsx` (replace), `ComplaintPanel.tsx`, `SapFindingsPanel.tsx`, `ProposalCard.tsx`, `src/components/domain/DocFlow.tsx`, `PayloadView.tsx`, `Timeline.tsx`, `src/features/audit/AuditTimeline.tsx`
- Test: `src/features/case/__tests__/ProposalCard.test.tsx`, `src/components/domain/__tests__/PayloadView.test.tsx`

**Interfaces:**
- Produces: `<DocFlow findings sapDocuments />`, `<PayloadView payload />` (key/value + raw toggle + copy), `<Timeline events />`, `<ProposalCard proposal canChoose onChoose onSendToApproval />`, `<AuditTimeline caseData />` (groups by L4 step, export JSON).

- [ ] **Step 1: Failing tests**

```tsx
// PayloadView.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'; import { PayloadView } from '../PayloadView'
it('renders keys and toggles raw json', () => { render(<PayloadView payload={{ CreditMemoRequestType: 'YCR', HeaderBillingBlockReason: '08', to_Item: [{ Material: '54' }] }} />); expect(screen.getByText('CreditMemoRequestType')).toBeInTheDocument(); expect(screen.getByText('YCR')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: /raw json/i })); expect(screen.getByText(/"HeaderBillingBlockReason": "08"/)).toBeInTheDocument() })
// ProposalCard.test.tsx
import { render, screen } from '@testing-library/react'; import { ProposalCard } from '../ProposalCard'; import type { Proposal } from '@reclaim/shared'
const p: Proposal = { id: 'p1', caseId: 'c', option: 'B', recommended: true, chosen: false, decision: { ruleId: 'R3', documentType: 'YCR', reasonCode: '104', material: '54', quantity: 2, unit: 'KG', amount: 540, currency: 'EUR', approverRole: 'credit_manager', intercompany: false, requiresCustomerConfirmation: false, notes: '' }, sapPayload: { CreditMemoRequestType: 'YCR' }, explanation: 'Rule R3 applies.', policyCitations: [{ ruleId: 'R3', text: 'R3 — Goods ruined' }], replyDraft: 'Dear customer', briefing: { whatHappened: 'a', whatWePropose: 'b', risk: 'c' }, createdAt: '2026-10-05T08:00:00Z' }
it('shows rule, decision table, recommended marker', () => { render(<ProposalCard proposal={p} canChoose onChoose={() => {}} />); expect(screen.getByText('Recommended')).toBeInTheDocument(); expect(screen.getByText('540.00 EUR')).toBeInTheDocument(); expect(screen.getByText(/R3 — Goods ruined/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: /choose this option/i })).toBeInTheDocument() })
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: DocFlow, PayloadView, Timeline**

```tsx
// DocFlow.tsx
import type { Findings, SapDocument } from '@reclaim/shared'; import { ArrowRight } from 'lucide-react'
export function DocFlow({ findings, sapDocuments }: { findings: Findings; sapDocuments: SapDocument[] }) { const inv = findings.invoice ?? findings.candidateInvoices[0]; if (!inv) return null; const it = inv.items[0]!; const nodes = [{ k: 'Sales order', v: it.salesOrder }, { k: 'Delivery', v: it.delivery }, { k: 'Invoice', v: inv.number, hi: true }, ...sapDocuments.map((d) => ({ k: d.type === 'YRE' ? 'Return' : 'Credit memo request', v: d.number, hi: true })), ...findings.existingReturns.map((d) => ({ k: 'Existing return', v: d.number })), ...findings.existingCredits.map((d) => ({ k: 'Existing credit', v: d.number }))]
  return (<ol className="flex flex-wrap items-center gap-2" aria-label="Document flow">{nodes.map((n, i) => (<li key={i} className="flex items-center gap-2">{i > 0 && <ArrowRight className="size-4 text-muted" aria-hidden />}<div className={`rounded-md border px-3 py-1.5 ${n.hi ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}><div className="text-[10px] uppercase tracking-wider text-muted">{n.k}</div><div className="font-mono text-sm">{n.v}</div></div></li>))}</ol>) }
// PayloadView.tsx
import { useState } from 'react'; import { toast } from 'sonner'
export function PayloadView({ payload }: { payload: Record<string, unknown> }) { const [raw, setRaw] = useState(false); const json = JSON.stringify(payload, null, 2)
  const copy = () => navigator.clipboard?.writeText(json).then(() => toast.success('Copied')).catch(() => toast.error('Copy not available'))
  return (<div className="rounded-md border border-line bg-surface-2"><div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-muted"><span>SAP payload (sent unchanged after approval)</span><div className="flex gap-3"><button onClick={() => setRaw(!raw)} className="underline">{raw ? 'Fields' : 'Raw JSON'}</button><button onClick={copy} className="underline">Copy</button></div></div>
    {raw ? <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">{json}</pre> : <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 p-3 font-mono text-xs">{Object.entries(payload).map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-all">{Array.isArray(v) ? v.map((x) => JSON.stringify(x)).join('\n') : String(v)}</dd></div>))}</dl>}</div>) }
// Timeline.tsx
import type { CaseEvent } from '@reclaim/shared'; import { L4_STEPS } from '@reclaim/shared'; import { useState } from 'react'; import { Cpu, Search, Scale, FileText, UserCheck, Database, AlertTriangle, Mail, Flag } from 'lucide-react'; import { formatDateTime } from '@/lib/format'
const icon = { intake: Mail, lookup: Search, rule: Scale, model: Cpu, proposal: FileText, approval: UserCheck, sap_write: Database, sap_release: Database, status: Flag, error: AlertTriangle }
export function Timeline({ events }: { events: CaseEvent[] }) { const [open, setOpen] = useState<string | null>(null)
  return (<ol className="relative border-l border-line ml-3">{events.map((e) => { const Icon = icon[e.kind]; const bad = e.kind === 'error'; return (<li key={e.id} className="ml-5 pb-4"><span className={`absolute -left-[9px] mt-1 flex size-[18px] items-center justify-center rounded-full border ${bad ? 'border-bad bg-bad-soft text-bad' : e.kind === 'model' ? 'border-teal bg-info-soft text-teal' : 'border-line bg-surface text-muted'}`}><Icon className="size-3" /></span>
    <div className="flex items-baseline gap-2 text-sm"><span className={bad ? 'font-medium text-bad' : 'font-medium'}>{e.title}</span>{e.l4Step && <span className="font-mono text-[11px] text-accent-fg bg-accent-soft rounded px-1" title={L4_STEPS[e.l4Step].name}>{e.l4Step}</span>}<span className="ml-auto text-xs text-muted tnum">{formatDateTime(e.at)}{e.durationMs != null ? ` · ${e.durationMs} ms` : ''}</span></div>
    {Object.keys(e.detail).length > 0 && <button onClick={() => setOpen(open === e.id ? null : e.id)} className="text-xs text-muted underline">{open === e.id ? 'Hide detail' : 'Detail'}</button>}{open === e.id && <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify(e.detail, null, 2)}</pre>}</li>) })}</ol>) }
```

- [ ] **Step 4: Case panels and page**

```tsx
// ComplaintPanel.tsx
import type { Case } from '@reclaim/shared'; import { COMPLAINT_LABELS } from '@reclaim/shared'; import { formatDateTime } from '@/lib/format'
export function ComplaintPanel({ c }: { c: Case }) { const f = c.facts; return (<section className="rounded-lg border border-line bg-surface p-4"><h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Complaint</h2><div className="mt-2 text-sm"><div className="font-medium">{c.subject}</div><div className="text-muted">{c.from} · {formatDateTime(c.receivedAt)}</div></div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed">{c.bodyText}</pre>
  {c.attachments.map((a) => a.mimeType.startsWith('image/') ? <figure key={a.name} className="mt-3"><img src={a.url} alt={a.name} className="max-h-56 rounded border border-line" /><figcaption className="text-xs text-muted">{a.name}</figcaption></figure> : <div key={a.name} className="text-xs">{a.name}</div>)}
  {c.anomalies.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{c.anomalies.map((a) => <span key={a} className="rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">{a}</span>)}</div>}
  {f && <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-sm"><dt className="text-muted">What the agent read</dt><dd>{COMPLAINT_LABELS[f.complaintType]}</dd><dt className="text-muted">Invoice named</dt><dd className="font-mono">{f.invoiceNumber ?? 'none'}</dd><dt className="text-muted">Quantity claimed</dt><dd className="tnum">{f.claimedQuantity ?? '–'} {f.unit}</dd>{f.claimedUnitPrice != null && <><dt className="text-muted">Price claimed</dt><dd className="tnum">{f.claimedUnitPrice} / {f.unit}</dd></>}<dt className="text-muted">Wants replacement</dt><dd>{f.wantsReplacement ? 'Yes' : 'No'}</dd><dt className="text-muted">Goods returnable</dt><dd>{f.goodsReturnable == null ? 'Unclear' : f.goodsReturnable ? 'Yes' : 'No (lost or ruined)'}</dd><dt className="text-muted">Evidence</dt><dd>{f.evidence || '–'}</dd></dl>}</section>) }
// SapFindingsPanel.tsx
import type { Case } from '@reclaim/shared'; import { DocFlow } from '@/components/domain/DocFlow'; import { formatMoney, formatQty, formatDate } from '@/lib/format'
export function SapFindingsPanel({ c }: { c: Case }) { const f = c.findings; if (!f) return <section className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">Not investigated yet. Run the case to look up the invoice in SAP.</section>; const inv = f.invoice ?? f.candidateInvoices[0]; const it = inv?.items[0]
  return (<section className="rounded-lg border border-line bg-surface p-4"><h2 className="text-sm font-semibold uppercase tracking-wider text-muted">What we found in SAP</h2>{!f.invoice && f.candidateInvoices.length > 0 && <p className="mt-2 rounded bg-warn-soft px-3 py-2 text-sm text-warn">No invoice number in the email. Searched the customer's invoices for material {c.facts?.material} and found {f.candidateInvoices.length} candidate(s). The customer must confirm.</p>}{!inv && <p className="mt-2 text-sm text-bad">Invoice not found.</p>}
    {inv && it && <><div className="mt-3"><DocFlow findings={f} sapDocuments={c.sapDocuments} /></div><dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-1 text-sm"><dt className="text-muted">Invoice</dt><dd className="col-span-2 font-mono">{inv.number} · {formatDate(inv.date)}</dd><dt className="text-muted">Customer</dt><dd className="col-span-2">{inv.customerName} ({inv.customer})</dd><dt className="text-muted">Sales area</dt><dd className="col-span-2 font-mono">{inv.salesOrg}/{inv.distributionChannel}/{inv.division} · company {inv.companyCode}</dd><dt className="text-muted">Item {it.item}</dt><dd className="col-span-2">{it.description} (material {it.material}) · {formatQty(it.quantity, it.unit)} × {formatMoney(it.unitPrice, inv.currency)} = {formatMoney(it.netAmount, inv.currency)} · plant {it.plant}</dd>
      {f.agreedUnitPrice != null && <><dt className="text-muted">Agreed price (PR00)</dt><dd className={`col-span-2 tnum ${f.agreedUnitPrice === it.unitPrice ? 'text-ok' : 'text-warn'}`}>{formatMoney(f.agreedUnitPrice, inv.currency)} per {it.unit} · invoiced {formatMoney(it.unitPrice, inv.currency)} {f.agreedUnitPrice === it.unitPrice ? '· matches' : '· differs'}</dd></>}
      <dt className="text-muted">Existing documents</dt><dd className="col-span-2">{f.existingReturns.length + f.existingCredits.length === 0 ? <span className="text-ok">none for this invoice</span> : [...f.existingReturns, ...f.existingCredits].map((d) => <span key={d.number} className="mr-2 font-mono text-warn">{d.type} {d.number}</span>)}</dd>
      {f.plantCompanyCode && f.plantCompanyCode !== inv.companyCode && <><dt className="text-muted">Intercompany</dt><dd className="col-span-2 text-warn">Sold by {inv.companyCode}, shipped from a {f.plantCompanyCode} plant. Flag an intercompany credit for finance (5.2.2).</dd></>}</dl></>}
    <div className="mt-3 text-xs text-muted">{f.lookups.length} SAP lookups · {f.lookups.reduce((s, l) => s + l.durationMs, 0)} ms</div></section>) }
// ProposalCard.tsx
import type { Proposal } from '@reclaim/shared'; import { REASON_CODES, ROLE_LABELS } from '@reclaim/shared'; import { RuleBadge } from '@/components/domain/RuleBadge'; import { DocTypeBadge } from '@/components/domain/DocTypeBadge'; import { PayloadView } from '@/components/domain/PayloadView'; import { Button } from '@/components/ui/button'; import { formatMoney, formatQty } from '@/lib/format'
export function ProposalCard({ proposal: p, canChoose, onChoose }: { proposal: Proposal; canChoose: boolean; onChoose: (id: string) => void }) { const d = p.decision
  return (<article className={`rounded-lg border bg-surface p-4 ${p.recommended && p.option !== 'single' ? 'border-accent' : 'border-line'}`}><header className="flex items-center gap-2">{p.option !== 'single' && <span className="font-semibold">Option {p.option}</span>}<RuleBadge ruleId={d.ruleId} /><DocTypeBadge type={d.documentType} />{p.recommended && p.option !== 'single' && <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-green">Recommended</span>}{p.chosen && p.option !== 'single' && <span className="rounded bg-ok-soft px-2 py-0.5 text-xs text-ok">Chosen</span>}{d.intercompany && <span className="rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">Intercompany</span>}</header>
    <blockquote className="mt-3 border-l-2 border-accent pl-3 text-sm text-muted">{p.policyCitations.map((c) => <p key={c.ruleId}>{c.text}</p>)}</blockquote>
    <p className="mt-3 text-sm leading-relaxed">{p.explanation}</p>
    <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 rounded-md bg-surface-2 p-3 text-sm"><dt className="text-muted">Document</dt><dd>{d.documentType === 'NONE' ? 'none' : d.documentType}{d.reasonCode && ` · reason ${d.reasonCode} (${REASON_CODES[d.reasonCode]})`}</dd><dt className="text-muted">Quantity</dt><dd className="tnum">{d.quantity > 0 ? formatQty(d.quantity, d.unit) : '–'}</dd><dt className="text-muted">Amount</dt><dd className="tnum font-mono">{d.amount > 0 ? formatMoney(d.amount, d.currency) : '–'}</dd><dt className="text-muted">Approver</dt><dd>{d.approverRole ? ROLE_LABELS[d.approverRole] : 'not required'}</dd>{d.documentType !== 'NONE' && <><dt className="text-muted">Billing block</dt><dd>08 Check Credit Memo, until approved</dd></>}</dl>
    {p.sapPayload && <div className="mt-3"><PayloadView payload={p.sapPayload} /></div>}
    <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Reply draft to the customer</summary><pre className="mt-2 whitespace-pre-wrap rounded bg-surface-2 p-3 font-sans">{p.replyDraft}</pre></details>
    {canChoose && !p.chosen && <div className="mt-4"><Button onClick={() => onChoose(p.id)}>Choose this option</Button></div>}</article>) }
// CasePage.tsx
import { useParams, Link } from '@tanstack/react-router'; import { useCase, useRunCase, useChoose } from '@/api'; import { ComplaintPanel } from './ComplaintPanel'; import { SapFindingsPanel } from './SapFindingsPanel'; import { ProposalCard } from './ProposalCard'; import { StatusChip } from '@/components/domain/StatusChip'; import { AuditTimeline } from '@/features/audit/AuditTimeline'; import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'; import { Button } from '@/components/ui/button'; import { Skeleton } from '@/components/ui/skeleton'; import { ErrorState } from '@/components/domain/ErrorState'; import { Play } from 'lucide-react'
export function CasePage() { const { id } = useParams({ from: '/cases/$id' }); const q = useCase(id); const run = useRunCase(); const choose = useChoose(); const c = q.data
  if (q.isLoading) return <Skeleton className="h-96" />; if (q.error || !c) return <ErrorState error={q.error ?? 'Not found'} onRetry={() => q.refetch()} />
  const two = c.proposals.length > 1; const running = c.status === 'investigating' || run.isPending
  return (<div><div className="mb-4 flex items-start gap-4"><div className="min-w-0"><div className="text-xs text-muted"><Link to="/" className="underline">Inbox</Link> / {c.id}</div><h1 className="truncate text-xl font-semibold">{c.subject}</h1><div className="mt-1 flex items-center gap-2 text-sm text-muted"><StatusChip status={c.status} />{c.invoiceNumber && <span className="font-mono">invoice {c.invoiceNumber}</span>}<span>{c.customerName}</span><span className="rounded bg-surface-2 px-1.5 text-xs">{c.aiMode === 'rules_only' ? 'rules only' : 'AI assisted'}</span></div></div>
    <div className="ml-auto flex gap-2">{c.status === 'awaiting_approval' && <Button asChild variant="outline"><Link to="/approvals">Open in approvals</Link></Button>}<Button onClick={() => run.mutate(id)} disabled={running}><Play className="size-4" /> {running ? 'Running…' : c.proposals.length ? 'Run again' : 'Run agent'}</Button></div></div>
    <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4"><ComplaintPanel c={c} /><SapFindingsPanel c={c} /></div>
    <section className="mt-4"><h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">{two ? 'Proposal: two options, a person chooses' : 'Proposal'}</h2>{c.proposals.length === 0 ? <div className="rounded-lg border border-dashed border-line p-8 text-center text-muted">{running ? 'The agent is working…' : 'No proposal yet. Run the agent.'}</div> : <div className={two ? 'grid grid-cols-2 gap-4' : ''}>{c.proposals.map((p) => <ProposalCard key={p.id} proposal={p} canChoose={two && c.status === 'awaiting_approval'} onChoose={(pid) => choose.mutate(pid)} />)}</div>}</section>
    <Tabs defaultValue="timeline" className="mt-6"><TabsList><TabsTrigger value="timeline">Timeline &amp; audit</TabsTrigger><TabsTrigger value="raw">Raw data</TabsTrigger></TabsList><TabsContent value="timeline"><AuditTimeline c={c} /></TabsContent><TabsContent value="raw"><pre className="overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs">{JSON.stringify(c, null, 2)}</pre></TabsContent></Tabs></div>) }
// audit/AuditTimeline.tsx
import type { Case } from '@reclaim/shared'; import { Timeline } from '@/components/domain/Timeline'; import { Button } from '@/components/ui/button'; import { toast } from 'sonner'
export function AuditTimeline({ c }: { c: Case }) { const exportJson = () => navigator.clipboard?.writeText(JSON.stringify({ case: c.id, exportedAt: new Date().toISOString(), events: c.events, approvals: c.approvals, sapDocuments: c.sapDocuments }, null, 2)).then(() => toast.success('Audit trail copied as JSON')).catch(() => toast.error('Copy not available'))
  return (<div className="rounded-lg border border-line bg-surface p-4"><div className="mb-3 flex items-center justify-between"><div className="text-sm text-muted">{c.events.length} events · every SAP call, rule, model call and approval, with the L4 step it belongs to</div><Button variant="outline" size="sm" onClick={exportJson}>Export JSON</Button></div>{c.events.length ? <Timeline events={c.events} /> : <div className="text-sm text-muted">No events yet.</div>}</div>) }
```

- [ ] **Step 5: Run tests, typecheck, build.**  Expected: PASS.

- [ ] **Step 6: Commit**  `git add apps/web && git commit -m "feat(web): case page with complaint, SAP findings, proposals and audit timeline"`

---

### Task 10: Approvals page

**Files:**
- Create: `src/features/approvals/ApprovalsPage.tsx` (replace), `ApprovalPanel.tsx`, `QuantityEditor.tsx`
- Test: `src/features/approvals/__tests__/QuantityEditor.test.tsx`

**Interfaces:**
- Produces: `<QuantityEditor value max unit unitPrice currency onChange />` reporting `{ quantity, valid }`; `<ApprovalPanel caseData proposal role actor />` with approve, reject, release and inline failure rendering.

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'; import { QuantityEditor } from '../QuantityEditor'
it('clamps above invoiced and reports invalid', () => { const on = vi.fn(); render(<QuantityEditor value={2} max={20} unit="KG" unitPrice={270} currency="EUR" onChange={on} />); const input = screen.getByLabelText(/quantity/i); fireEvent.change(input, { target: { value: '99' } }); expect(screen.getByText(/cannot exceed 20 KG/i)).toBeInTheDocument(); expect(on).toHaveBeenLastCalledWith({ quantity: 99, valid: false }); fireEvent.change(input, { target: { value: '3' } }); expect(screen.getByText('810.00 EUR')).toBeInTheDocument(); expect(on).toHaveBeenLastCalledWith({ quantity: 3, valid: true }) })
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```tsx
// QuantityEditor.tsx
import { useState } from 'react'; import { formatMoney } from '@/lib/format'
export function QuantityEditor({ value, max, unit, unitPrice, currency, onChange }: { value: number; max: number; unit: string | null; unitPrice: number; currency: string; onChange: (r: { quantity: number; valid: boolean }) => void }) { const [v, setV] = useState(String(value)); const n = Number(v); const valid = Number.isFinite(n) && n > 0 && n <= max
  return (<div className="text-sm"><label className="flex items-center gap-2">Quantity<input aria-label="Quantity" type="number" min={0} max={max} step="0.001" value={v} onChange={(e) => { setV(e.target.value); const q = Number(e.target.value); onChange({ quantity: q, valid: Number.isFinite(q) && q > 0 && q <= max }) }} className={`w-24 rounded-md border px-2 py-1 tnum ${valid ? 'border-line' : 'border-bad'}`} /><span className="text-muted">{unit} of {max} invoiced</span></label>{!valid && <div className="mt-1 text-xs text-bad">Quantity cannot exceed {max} {unit} and must be above 0.</div>}<div className="mt-1 text-muted">New amount: <span className="font-mono tnum text-fg">{valid ? formatMoney(n * unitPrice, currency) : '–'}</span></div></div>) }
// ApprovalPanel.tsx
import { useState } from 'react'; import type { Case, Proposal, Role } from '@reclaim/shared'; import { ROLE_LABELS, REASON_CODES } from '@reclaim/shared'; import { useApprove, useReject, useRelease } from '@/api'; import type { ApproveResult } from '@/api'; import { QuantityEditor } from './QuantityEditor'; import { PayloadView } from '@/components/domain/PayloadView'; import { RuleBadge } from '@/components/domain/RuleBadge'; import { DocTypeBadge } from '@/components/domain/DocTypeBadge'; import { Button } from '@/components/ui/button'; import { formatMoney, formatQty } from '@/lib/format'; import { toast } from 'sonner'; import { Link } from '@tanstack/react-router'
export function ApprovalPanel({ c, p, role, actor }: { c: Case; p: Proposal; role: Role; actor: string }) { const approve = useApprove(); const reject = useReject(); const release = useRelease(); const [edit, setEdit] = useState<{ quantity: number; valid: boolean } | null>(null); const [comment, setComment] = useState(''); const [result, setResult] = useState<ApproveResult | null>(null); const d = p.decision; const max = c.findings?.invoice?.items[0]?.quantity ?? d.quantity; const unitPrice = c.findings?.invoice?.items[0]?.unitPrice ?? 0
  const canApprove = c.status === 'awaiting_approval' && !approve.isPending && (!edit || edit.valid); const doc = c.sapDocuments[c.sapDocuments.length - 1]
  const onApprove = () => approve.mutate({ proposalId: p.id, input: { actor, role, editedQuantity: edit && edit.valid && edit.quantity !== d.quantity ? edit.quantity : undefined, comment } }, { onSuccess: (r) => { setResult(r); if (r.ok) toast.success(d.documentType === 'NONE' ? 'Reply approved, case closed' : `${d.documentType} ${r.document.number} created`) } })
  return (<aside className="rounded-lg border border-line bg-surface p-4"><div className="text-xs text-muted"><Link to="/cases/$id" params={{ id: c.id }} className="underline">{c.id}</Link> · {c.customerName} · invoice <span className="font-mono">{c.invoiceNumber ?? 'none'}</span></div><h2 className="mt-1 text-lg font-semibold">{c.subject}</h2>
    <div className="mt-3 rounded-md border-l-2 border-accent bg-accent-soft/40 p-3 text-sm"><div><span className="font-medium">What happened.</span> {p.briefing.whatHappened}</div><div><span className="font-medium">What we propose.</span> {p.briefing.whatWePropose}</div><div><span className="font-medium">Risk.</span> {p.briefing.risk}</div></div>
    <div className="mt-3 flex items-center gap-2"><RuleBadge ruleId={d.ruleId} /><DocTypeBadge type={d.documentType} />{d.reasonCode && <span className="text-xs text-muted">reason {d.reasonCode} · {REASON_CODES[d.reasonCode]}</span>}{d.intercompany && <span className="rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">Intercompany</span>}</div>
    <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm"><dt className="text-muted">Quantity</dt><dd className="tnum">{formatQty(d.quantity, d.unit)}</dd><dt className="text-muted">Amount</dt><dd className="font-mono tnum">{formatMoney(d.amount, d.currency)}</dd><dt className="text-muted">Required approver</dt><dd>{d.approverRole ? ROLE_LABELS[d.approverRole] : '–'}</dd><dt className="text-muted">You are</dt><dd>{ROLE_LABELS[role]}</dd></dl>
    {p.sapPayload && <div className="mt-3"><PayloadView payload={p.sapPayload} /></div>}
    {c.status === 'awaiting_approval' && (<div className="mt-4 space-y-3 border-t border-line pt-3">{d.documentType !== 'NONE' && <QuantityEditor value={d.quantity} max={max} unit={d.unit} unitPrice={unitPrice} currency={d.currency} onChange={setEdit} />}<label className="block text-sm">Comment<textarea value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface p-2" rows={2} /></label>
      <div className="flex gap-2"><Button onClick={onApprove} disabled={!canApprove}>{approve.isPending ? 'Writing to SAP…' : d.documentType === 'NONE' ? 'Approve reply' : `Approve and create ${d.documentType}`}</Button><Button variant="outline" disabled={!comment.trim() || reject.isPending} onClick={() => reject.mutate({ proposalId: p.id, input: { actor, role, comment } }, { onSuccess: () => toast('Rejected') })}>Reject</Button></div><p className="text-xs text-muted">Approving sends exactly the payload above to SAP with the record's ETag. If the record changed since it was read, SAP refuses with 412 and nothing is written.</p></div>)}
    {result && !result.ok && (<div role="alert" className="mt-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad"><div className="font-semibold">SAP refused the write · HTTP {result.status}</div><div>{result.message}</div><div className="mt-2"><Button size="sm" variant="outline" onClick={() => setResult(null)}>Reload case</Button></div></div>)}
    {c.status === 'written_to_sap' && doc && (<div className="mt-4 rounded-md border border-ok bg-ok-soft p-3 text-sm"><div className="font-semibold text-ok">{doc.type} {doc.number} created in SAP with billing block 08</div><div className="text-muted">Step {doc.type === 'YRE' ? '5.1.2' : '5.2.1'} done. {doc.released ? 'Billing block removed: billing can create the credit memo.' : 'Release removes the block so billing can create the credit memo.'}</div>{!doc.released && <Button size="sm" className="mt-2" disabled={release.isPending} onClick={() => release.mutate(doc.id, { onSuccess: (r) => (r.ok ? toast.success('Billing block removed') : toast.error(`${r.status}: ${r.message}`)) })}>Release billing block</Button>}</div>)}
    {c.status === 'closed' && <div className="mt-4 rounded-md border border-ok bg-ok-soft p-3 text-sm text-ok">Reply approved and sent. No SAP document.</div>}
    {c.status === 'rejected' && <div className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">Rejected: {c.approvals[c.approvals.length - 1]?.comment}</div>}</aside>) }
// ApprovalsPage.tsx
import { useState } from 'react'; import { useCases, useCase } from '@/api'; import { useUi } from '@/store/ui'; import { ROLE_LABELS, APPROVAL_THRESHOLDS, type CaseSummary } from '@reclaim/shared'; import { ApprovalPanel } from './ApprovalPanel'; import { StatusChip } from '@/components/domain/StatusChip'; import { RuleBadge } from '@/components/domain/RuleBadge'; import { EmptyState } from '@/components/domain/EmptyState'; import { formatMoney, formatRelative } from '@/lib/format'
const rank = { customer_service_lead: 0, credit_manager: 1, finance_director: 2, returns_desk: -1 } as const
export function ApprovalsPage() { const { role } = useUi(); const q = useCases(); const [sel, setSel] = useState<string | null>(null); const [all, setAll] = useState(false)
  const mine = (r: CaseSummary) => all || !r.approverRole || rank[role] >= rank[r.approverRole]
  const rows = (q.data ?? []).filter((r) => ['awaiting_approval', 'approved', 'written_to_sap', 'sap_write_failed', 'closed', 'rejected'].includes(r.status) && mine(r)).sort((a, b) => (a.status === 'awaiting_approval' ? -1 : 1) - (b.status === 'awaiting_approval' ? -1 : 1))
  const selected = sel ?? rows[0]?.id ?? null; const detail = useCase(selected ?? '__none__'); const c = detail.data; const p = c?.proposals.find((x) => x.chosen) ?? c?.proposals.find((x) => x.recommended) ?? c?.proposals[0]
  return (<div><div className="mb-4 flex items-end gap-4"><div><h1 className="text-xl font-semibold">Approvals</h1><p className="text-sm text-muted">Queue for {ROLE_LABELS[role]} · thresholds: {APPROVAL_THRESHOLDS.map((t) => `${t.upTo === Infinity ? 'above 5 000' : `up to ${t.upTo}`} → ${ROLE_LABELS[t.role]}`).join(' · ')}</p></div><label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all roles</label></div>
    {rows.length === 0 ? <EmptyState title="Nothing to approve" description="Run cases from the inbox. Proposals that need your role will appear here." /> : (<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4"><ul className="space-y-2">{rows.map((r) => (<li key={r.id}><button onClick={() => setSel(r.id)} className={`w-full rounded-lg border p-3 text-left ${selected === r.id ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface hover:bg-surface-2'}`}><div className="flex items-center gap-2"><RuleBadge ruleId={r.ruleId} /><span className="truncate font-medium">{r.subject}</span></div><div className="mt-1 flex items-center gap-2 text-xs text-muted"><StatusChip status={r.status} /><span>{r.customerName}</span><span className="font-mono tnum">{r.amount ? formatMoney(r.amount, r.currency) : 'no credit'}</span><span className="ml-auto">{formatRelative(r.updatedAt)}</span></div></button></li>))}</ul>{c && p ? <ApprovalPanel key={c.id + c.status} c={c} p={p} role={role} actor={ROLE_LABELS[role]} /> : <div />}</div>)}</div>) }
```

- [ ] **Step 4: Run tests, typecheck, build.**  Expected: PASS.

- [ ] **Step 5: Commit**  `git add apps/web && git commit -m "feat(web): approvals queue with inline SAP result, quantity editing and release"`

---

### Task 11: Analytics page with value calculator

Before writing chart code, load the `dataviz` skill (chart form, palette validation, both themes).

**Files:**
- Create: `src/features/analytics/AnalyticsPage.tsx` (replace), `ValueCalculator.tsx`, `charts.tsx`
- Test: `src/features/analytics/__tests__/value.test.ts`

**Interfaces:**
- Produces: `computeValue(input: ValueInput): ValueOutput` (pure, from the guide's formulas), charts `CasesByWeek`, `ValueByWeek`, `OutcomeMix` taking `AnalyticsSummary`.

- [ ] **Step 1: Failing test (the guide's formulas)**

```ts
import { computeValue } from '../value'
it('matches the guide formulas', () => { const r = computeValue({ casesPerMonth: 200, minutesToday: 45, minutesWithAgent: 10, costPerHour: 60, errorRateToday: 0.08, sharePrevented: 0.75, lossPerError: 400, valuePerCase: 800, daysFaster: 5, costOfCapital: 0.06 }); expect(r.hoursSavedPerYear).toBeCloseTo(200 * 35 / 60 * 12, 5); expect(r.labourValuePerYear).toBeCloseTo(r.hoursSavedPerYear * 60, 5); expect(r.fteFreed).toBeCloseTo(r.hoursSavedPerYear / 1600, 5); expect(r.cashReleased).toBeCloseTo(200 * 800 * 5 / 30, 5); expect(r.financingGainPerYear).toBeCloseTo(r.cashReleased * 0.06, 5); expect(r.errorsAvoidedPerYear).toBeCloseTo(200 * 12 * 0.08 * 0.75 * 400, 5); expect(r.valuePerYear).toBeCloseTo(r.labourValuePerYear + r.financingGainPerYear + r.errorsAvoidedPerYear, 5) })
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: value.ts, ValueCalculator.tsx, charts.tsx, AnalyticsPage.tsx**

```ts
// value.ts
export interface ValueInput { casesPerMonth: number; minutesToday: number; minutesWithAgent: number; costPerHour: number; errorRateToday: number; sharePrevented: number; lossPerError: number; valuePerCase: number; daysFaster: number; costOfCapital: number }
export interface ValueOutput { hoursSavedPerYear: number; labourValuePerYear: number; fteFreed: number; cashReleased: number; financingGainPerYear: number; errorsAvoidedPerYear: number; valuePerYear: number }
export const DEFAULT_VALUE_INPUT: ValueInput = { casesPerMonth: 200, minutesToday: 45, minutesWithAgent: 10, costPerHour: 60, errorRateToday: 0.08, sharePrevented: 0.75, lossPerError: 400, valuePerCase: 800, daysFaster: 5, costOfCapital: 0.06 }
export function computeValue(i: ValueInput): ValueOutput { const hoursSavedPerYear = (i.casesPerMonth * (i.minutesToday - i.minutesWithAgent)) / 60 * 12; const labourValuePerYear = hoursSavedPerYear * i.costPerHour; const fteFreed = hoursSavedPerYear / 1600; const cashReleased = (i.casesPerMonth * i.valuePerCase * i.daysFaster) / 30; const financingGainPerYear = cashReleased * i.costOfCapital; const errorsAvoidedPerYear = i.casesPerMonth * 12 * i.errorRateToday * i.sharePrevented * i.lossPerError; return { hoursSavedPerYear, labourValuePerYear, fteFreed, cashReleased, financingGainPerYear, errorsAvoidedPerYear, valuePerYear: labourValuePerYear + financingGainPerYear + errorsAvoidedPerYear } }
```
`ValueCalculator.tsx`: a two-column form (inputs with labels from the guide: complaints per month, minutes per complaint today, minutes with the agent, loaded cost per hour, complaints handled wrongly today %, share the agent prevents %, average loss per wrong handling, value per case, days faster, cost of capital %) and a results column of `KpiTile`s (value per year, hours saved, labour value, FTE freed, cash released once, financing gain, errors avoided). Percent inputs are shown as whole numbers and divided by 100. A note: "Every value is an editable assumption, not a measurement."

`charts.tsx` (Recharts, colours from CSS tokens read via `getComputedStyle(document.documentElement).getPropertyValue('--teal')` etc. in a small `useTokens()` hook so both themes work): `CasesByWeek` stacked `BarChart` with series damaged, ruined, quality, price, short_delivery, other; `ValueByWeek` grouped bars approved vs rejected; `OutcomeMix` horizontal bars from `byStatus`. Each in a card with a title and a one-line reading of the chart. Axis labels tabular, grid faint, tooltip with formatted money.

`AnalyticsPage.tsx`: KPI row (cases this month, pending approvals, approved value, median hours to approval, accepted unchanged %, duplicates prevented, intercompany flagged), then the three charts in a 2+1 grid, then "Demo history: 12 weeks of synthetic cases, marked as such" caption, then `ValueCalculator`.

- [ ] **Step 4: Run tests, typecheck, build.**  Expected: PASS.

- [ ] **Step 5: Commit**  `git add apps/web && git commit -m "feat(web): analytics dashboard and value calculator"`

---

### Task 12: Evaluation page

**Files:**
- Create: `src/features/evaluation/EvaluationPage.tsx` (replace)

- [ ] **Step 1: Implement**

```tsx
import { useEval, useRunEval } from '@/api'; import { Button } from '@/components/ui/button'; import { EmptyState } from '@/components/domain/EmptyState'; import { FlaskConical } from 'lucide-react'
const COLS = ['rule', 'document', 'reason', 'quantity', 'amount', 'approver', 'option A']
export function EvaluationPage() { const q = useEval(); const run = useRunEval(); const res = q.data; const passed = res?.filter((r) => r.pass).length ?? 0
  return (<div><div className="mb-4 flex items-end gap-4"><div><h1 className="text-xl font-semibold">Evaluation</h1><p className="text-sm text-muted">The eight demo complaints against the organizers' expected results. The decision object is scored field by field; the model's prose is not.</p></div><div className="ml-auto flex items-center gap-3">{res && <span className={`text-lg font-semibold tnum ${passed === res.length ? 'text-ok' : 'text-bad'}`}>{passed} of {res.length} passing</span>}<Button onClick={() => run.mutate()} disabled={run.isPending}><FlaskConical className="size-4" /> {run.isPending ? 'Running…' : 'Run evaluation'}</Button></div></div>
    {!res ? <EmptyState title="No evaluation yet" description="Runs every demo case that has no proposal, then compares rule, document type, reason code, quantity, amount and approver with expected-results.json." action={<Button onClick={() => run.mutate()}>Run evaluation</Button>} /> : (<div className="overflow-x-auto rounded-lg border border-line bg-surface"><table className="w-full text-sm"><thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted"><tr><th className="px-3 py-2 text-left">Case</th>{COLS.map((c) => <th key={c} className="px-3 py-2 text-left">{c}</th>)}<th className="px-3 py-2 text-left">Result</th></tr></thead><tbody>{res.map((r) => (<tr key={r.caseId} className="border-t border-line"><td className="px-3 py-2"><div className="font-medium">{r.caseId}</div><div className="font-mono text-xs text-muted">{r.emailFile}</div></td>{COLS.map((c) => { const f = r.fields.find((x) => x.name === c); return <td key={c} className="px-3 py-2">{f ? <span title={`expected ${f.expected || '—'} · actual ${f.actual || '—'}`} className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs ${f.pass ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{f.actual || '—'}{!f.pass && <span className="ml-1 text-muted">≠ {f.expected || '—'}</span>}</span> : <span className="text-muted">–</span>}</td> })}<td className={`px-3 py-2 font-semibold ${r.pass ? 'text-ok' : 'text-bad'}`}>{r.pass ? 'PASS' : 'FAIL'}</td></tr>))}</tbody></table></div>)}</div>) }
```

- [ ] **Step 2: Typecheck, build, run all tests.**  Expected: PASS.

- [ ] **Step 3: Commit**  `git add apps/web && git commit -m "feat(web): evaluation matrix against expected results"`

---

### Task 13: Polish, demo script, README

**Files:**
- Create: `docs/demo-script.md`, `README.md`, `apps/web/.env.example`
- Modify: whatever the visual pass finds

- [ ] **Step 1: Visual pass in the browser**

Run `npm run dev`, open `http://localhost:5173`, walk the demo in both themes: seed, run all, open case 01, choose option B, approvals as credit manager, approve, release, toggle "Simulate SAP conflict" in the top bar, approve case 08 and see the 412 panel, evaluation 8 of 8, analytics. Fix clipped text, misaligned baselines, missing empty states, contrast in dark mode. No new features.

- [ ] **Step 2: demo-script.md**

Write the exact click sequence with timings (target 8 minutes): 1 intro on the principle (Inbox empty, seed), 2 run all and watch statuses move, 3 case 01 deep dive (photo, two options, choose B), 4 approvals: approve case 01, document number, release, 5 case 06 duplicate prevented, 6 case 08 intercompany flag and the 412 demo with the conflict switch on, 7 evaluation 8 of 8, 8 analytics and value calculator, 9 rules-only toggle and run case 03 again, 10 architecture slide.

- [ ] **Step 3: README.md**

How to run (`npm install`, `npm run dev`), env vars (`VITE_API_MODE=mock|http`, `VITE_API_BASE`), where the contract lives, how the backend team plugs in, how to run tests. `.env.example` with the two variables.

- [ ] **Step 4: Full verification**

Run: `npm run lint && npm run typecheck && npm test && npm run build`  Expected: all green. Paste the output in the commit body if anything was skipped.

- [ ] **Step 5: Commit**  `git add -A && git commit -m "docs: demo script, README and visual polish"`
