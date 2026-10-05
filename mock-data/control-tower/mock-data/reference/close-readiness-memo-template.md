# Close readiness · {period} (as of {run_date})

**Verdict: {ready | at risk | not ready}.** {one sentence: the rule that decided it, with the count and value behind it}

Read-only report from the O2C Control Tower. Nothing was changed in SAP. Every figure below comes from SAP reads on {run_date}; amounts are per currency and never added across currencies.

## KPIs

| KPI | Value | Detail |
|---|---|---|
| Shipped, not billed | {value per currency} | {n} deliveries past 3 days, {n} past 14 days, oldest {d} days; {n} valued |
| Waiting for POD | {value per currency} | {n} past 3 days, {n} past 14 days |
| Blocked orders | {value per currency} | {n} orders; ageing 0–7: {n}, 8–30: {n}, 31+: {n}; {n} credit |
| Overdue receivables | {value per currency} | {n} customers in {company codes} |
| Returns without credit | {value per currency} | {n} returns |
| Conformance | {n} orders walked | {n} conform; deviations by L4: {4.1.1: n, …} |

## What blocks the close

1. {category}: {value} in {n} items, {n} high. Owner: {fixing agent}.
2. …

## Findings (top 10 per category; the rest in the run record)

| Document | Customer (country) | Value | Severity | L4 | Why | Route to | Owner of the data |
|---|---|---|---|---|---|---|---|
| {type} {number} | {customer} ({cc}) | {amount} {cur} | {high/medium} | {l4} | {reason with numbers} | {agent} | {team Txx / shared / other} |

## Routed today

- {agent}: {n} findings, note {id}

## Not read this run

- {tool or API}: {error} (the memo is incomplete for this section)

## Legacy items (older than one year, reported, not deciding this close)

- {n} deliveries / orders, oldest {date}. Owner per item: the team whose data sheet lists it (route to its agent), else `other`, for a person to clean up.
