> **Extra credit.** This pack is optional: build it after (or alongside) your main agent.

# O2C Control Tower agent

Open **`Control-Tower-Guide.html`** in a browser: it is the complete guide (process, L3/L4 steps, SAP APIs and BTP services, demo data, value calculator, SAP GUI and Fiori checks, test cases, and a stretch goal: a dashboard).

The Control Tower **only reads** SAP. It finds where money leaks (shipped but unbilled, waiting for POD, blocked, overdue), answers management questions, writes a close-readiness memo and routes each finding to the agent that fixes it. It never changes a document.

`mock-data/` holds what you need to build and test:

- `emails/`: management questions as `.eml` files (DSO for Norway, what blocks the close, one customer, one order, a request to release a block), plus two example routing notes the agent sends
- `reference/`: the L4 steps a finding points to, KPI definitions, the routing table (finding → agent), the close-readiness memo template, suggested starting rules and customer countries
- `sap-responses/`: real answers of SAP DS4 (JSON, captured 1 Oct 2026): leakage scan, conformance check of an order with a deviation at 4.1.1, unbilled deliveries, deliveries awaiting POD, blocked orders, billing due list, customer countries
- `expected-results.json`: the correct outcome for each mock input, usable as an automated test oracle

## Which data is yours

The Control Tower has **no documents of its own**: everything it reads is shared and read-only (team data sheet, `TEAM-DATA.md`: "Control Tower: read-only"). Your team's own documents for the other scenarios (your row in the team data sheet, e.g. team T01's POD deliveries 80609005, 80609014, 80609024 or billing-blocked orders 1368, 1369, 1814) appear in your findings: label them with their team as owner and route them; never act on them. Shared data (unallocated POD deliveries 80608972–80608982, cash open items 1800000012 and 100000006) and everything else is read-only for everyone. Old (2019–2025) unbilled deliveries are mostly teams' Billing due-list items (e.g. T01: 80000170, 80000244, 80000313, 80000443): report them as legacy, but with their team as owner.

## More test data

The team data kit (`../team-data/`) has no script for the Control Tower: it needs none, because it reads what the other teams create. Your team's runs of `atp-rescue.mjs`, `inbox-to-order.mjs` or `returns-credit-note.mjs` with `--execute` add fresh documents tagged `HACK-<TEAM>-…` that your Control Tower will see. If you need a specific situation that is not on DS4 (for example a return with no credit note, or an overdue invoice for a given customer), ask the hackathon lead.
