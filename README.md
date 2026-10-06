# Reclaim

Returns & Credit Note agent for SAP Order-to-Cash (O2C Agent 8, Deloitte AI Agentic Enterprise Hackathon).

A complaint email comes in. The agent reads it, finds the invoice and its history in SAP, applies the written returns policy (rules R1 to R9), and proposes a customer return (YRE) or a credit memo request (YCR) with the right reason code and billing block 08. A named person approves. Only then is SAP written, with the record's version stamp so a conflicting change is refused, never overwritten.

**The model reads and explains. Deterministic rules set every amount. A person approves every SAP change.**

## Run it

```bash
npm install
npm run dev          # http://localhost:5173, runs on the in-browser mock backend
npm test             # shared + web tests, including the oracle against expected-results.json
npm run typecheck
npm run build
```

Environment (`apps/web/.env`, see `.env.example`):

| Variable | Values | Meaning |
|---|---|---|
| `VITE_API_MODE` | `mock` (default) / `http` | In-browser mock backend, or the real backend |
| `VITE_API_BASE` | e.g. `http://localhost:3000` | Base URL of the real backend when mode is `http` |

## Layout

```
apps/web          React + Vite frontend (this is what the demo runs)
apps/api          backend: to be built, see apps/api/README.md
packages/shared   the contract: enums, Zod schemas, policy table, rules engine, SAP payload builder, narrative templates, route table
mock-data         the organizers' mock data, plus mock-data/extra/08-intercompany.eml
docs              architecture, spec, plan, demo script
```

## For the backend team

- Implement the routes in `packages/shared/src/routes.ts`; validate responses with the schemas in `packages/shared/src/schemas.ts`.
- Reuse `decide()`, `buildSapPayload()` and `narrate()` from `@reclaim/shared` directly. The frontend's mock pipeline (`apps/web/src/api/mock/pipeline.ts`) shows the order of steps, the events with L4 step ids, and the status transitions.
- `apps/web/src/api/mock/__tests__/pipeline.test.ts` is the acceptance test: the real backend must produce the same decisions for the eight demo cases.
- Live updates: the frontend subscribes to `GET /api/events` as Server-Sent Events (`{"type":"case_changed","id":"..."}`), and falls back to polling.

## Demo

See `docs/demo-script.md`.
