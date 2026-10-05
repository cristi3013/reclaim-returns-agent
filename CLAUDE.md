# Reclaim · SAP O2C Returns & Credit Note agent

Deloitte AI Agentic Enterprise Hackathon entry. Presentation Tuesday 6 Oct 2026, 13:00.

**The model reads and explains. Code decides about money. A person approves every SAP change.**

## Start here

- `apps/api/BACKEND.md` — full context for backend work: flow, contracts, gateway status, model usage, what is left.
- `docs/Returns-Agent-Architecture.md` — functional and technical architecture.
- `docs/demo-script.md` — the stage demo, step by step.
- `mock-data/reference/returns-policy.md` — the nine policy rules the agent applies.

## Layout

- `packages/shared/src/control-tower` — the O2C Control Tower (extra credit): read-only scan, KPIs, findings, memo, questions, tested against `mock-data/control-tower/mock-data/expected-results.json`.
- `packages/shared` — the contract: enums, Zod schemas, policy table, `decide()` rules engine, `buildSapPayload()`, `narrate()`, route table, demo fixtures. Both apps import it. Change it with care: the frontend, the backend and the acceptance tests all depend on it.
- `apps/web` — React + Vite frontend. Done. Runs on an in-browser mock (`VITE_API_MODE=mock`, default) or the real backend (`VITE_API_MODE=http`). Installable PWA; the approval journey (inbox, approvals, case) works at phone width, analytics and evaluation are desktop screens.
- `apps/api` — Fastify backend. Skeleton done; see BACKEND.md for what remains.

## Commands

```bash
npm install                      # once, at the root (npm workspaces, not pnpm)
npm run dev                      # frontend on :5173 (mock backend)
npm run dev --workspace apps/api # backend on :3000
npm test                         # all tests (shared 33, web 44, api 32)
npm run build --workspace apps/web && npm run start --workspace apps/web   # what Railway runs (railway.json)
npm run typecheck && npm run lint
```

## Conventions

- TypeScript strict everywhere. Prettier: no semicolons, single quotes, width 100.
- Business decisions live in `packages/shared/src/rules.ts`, never in prompts or UI code.
- Every SAP-related step appends an audit event with its L4 process step id.
- Tests: `apps/api/test/acceptance.test.ts` and `apps/web/src/api/mock/__tests__/pipeline.test.ts` are the acceptance tests against `expected-results.json`. They must stay green.
- Sign-in is Supabase Auth, always on: the backend takes actor and role from the session token (`apps/api/src/auth.ts`), the web app shows a login page. Demo accounts: `cs.lead@`, `credit.manager@`, `finance.director@`, `returns.desk@reclaim.demo`, created by `apps/api/scripts/create-demo-users.mts`.
- Never write hackathon demo invoices (90000353–90000359) to the real DS4. Guarded in code; keep it that way.
- Conventional commit messages (`feat(api): …`, `fix(web): …`).
- Never hand-edit or regenerate `package-lock.json` on its own. Run `npm install` at the root (npm 10 or newer) and commit the result. A lockfile written any other way loses the Linux optional packages (`@rollup/rollup-linux-x64-gnu`) and every Railway build fails with "Cannot find module @rollup/rollup-linux-x64-gnu".
