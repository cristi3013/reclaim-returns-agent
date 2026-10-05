# Suggested starting rules

These are a starting point, not the answer. They worked on DS4 data on 1 Oct 2026. Change any threshold your team can justify, and write the change down: the jury asks why.

| # | Rule | Why |
|---|---|---|
| S1 | **Read only.** The agent has no write call: no POST, PATCH, PUT, DELETE, and no write tool of the MCP server. A request to change something becomes a routing note. | The Control Tower's value is a trustworthy picture. Fixing belongs to the agent that owns the step, behind its own approval. |
| S2 | Every finding carries: L4 step ID, document type and number, customer, value and currency, age in days, severity, the rule that fired, a one-line *why* with numbers, the fixing agent, and the data owner (`team Txx`, `shared` or `other`). | A finding without a route or a number is not actionable. |
| S3 | Shipped, not billed: goods issued more than **3** days ago and not billed is a leak; **high** after **14** days. Route to 7 Billing Gatekeeper, unless the POD is open (S4). | Three days covers a normal billing run. |
| S4 | POD pending: goods issued **3** days ago or more, POD open; **high** after **14** days. Route to 6 POD Chaser. When the same delivery is also unbilled, report it **once**, cause POD. | A POD-relevant delivery cannot be billed before its POD; counting it twice doubles the value at risk. |
| S5 | Blocks: every blocked order with its age bucket 0–7 / 8–30 / 31+ days; **high** after **30** days. Billing block after delivery = 4.1.4, others 2.3.3. Credit block: "a credit-limit change is master data: for a person". Route to 3 Block Buster. | Ageing shows which blocks nobody works on. |
| S6 | Overdue receivables per company code (YDE1 EUR, YRO1 RON) per customer; **high** from 10 000. Route to 9 Cash Application & Collections. | |
| S7 | Returns without credit: a customer return older than 7 days with no credit memo. Medium. Route to 8 Returns & Credit Note. | |
| S8 | Conformance: walk the most recent orders (15 is a good start) with the conformance check. Apply the same grace as S3/S4 before calling a 4.1.1 deviation a leak. | The check flags an order delivered yesterday as "not billed". |
| S9 | Close readiness for a period: **not ready** if any delivery with goods issue in that period is unbilled for more than 14 days (S3 or S4 high); **at risk** with any other high or medium finding; else **ready**. Items older than a year are legacy: reported, not deciding the close. | Management wants to know what keeps this month's revenue off the books. |
| S10 | Questions: parse the subject (country, customer, order) and the topic (DSO, close, leakage); answer from the latest snapshot with a breakdown per driver, value, count and top documents. No finding for the subject: say so plainly; never invent a cause. | "Why is DSO up for Norway?" has an honest answer even when there is no data. |
| S11 | Bounded reads: cap the number of SAP calls per run (60 is plenty); when a list returns exactly its row cap, page or narrow it and say so in the memo. A section that fails is reported as "not read", and the run continues. | |
| S12 | Routing: at most one note per fixing agent per day, listing its documents. A note informs; it never orders a write. The receiving agent acts only on documents its team owns. | Prevents spam and keeps ownership clear. |
