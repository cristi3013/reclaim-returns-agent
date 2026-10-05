# O2C reference process: the L4 steps the Control Tower watches

The full hierarchy (L1 Order to Cash, 7 L2 areas, 18 L3 processes, 48 L4 steps) is in
`../sap-responses/process-model.json` (MCP tool `s4_get_process_model`, resource `o2c://process-model`).
It comes from the hackathon process document, not from SAP. Every finding your agent reports names one L4 ID from it.

## The steps a finding points to

| L4 | L3 process | Step | What a deviation looks like in SAP | Fixing agent |
|---|---|---|---|---|
| 2.2.3 | Availability Check | Modify order based on the availability result | Order partly delivered, the rest still open (`OverallTotalDeliveryStatus` = `B`) | 2 ATP Rescue (info only) |
| 2.3.3 | Credit & Billing Block Management | Remove billing block upon approval | Order on credit block (`TotalCreditCheckStatus` = `B`) or any header block nobody works on | 3 Block Buster |
| 3.1.2 | Delivery Processing | Create delivery document (VL01N) | Invoice exists but no delivery: fine for services, odd for goods | none (info) |
| 3.1.4 | Delivery Processing | Remove delivery block | Delivery block set and no delivery created | 3 Block Buster |
| 3.4.1 | Proof of Delivery | Request POD from the logistics provider | Goods issued, POD-relevant, POD still open (`OverallProofOfDeliveryStatus` `A`/`B`) | 6 POD Chaser |
| 4.1.1 | Invoice Creation | Create billing document (VF01) based on delivery | Goods issued, not billed (`OverallDelivReltdBillgStatus` `A`/`B`) | 7 Billing Gatekeeper (6 POD Chaser when the POD is the cause) |
| 4.1.4 | Invoice Creation | Release billing block before invoice creation | Delivered, but the order still has a billing block | 3 Block Buster |
| 5.2.1 | Credit Note Processing | Create credit note for a return | Customer return (`YRE`) with no credit memo after 7 days | 8 Returns & Credit Note |
| 6.1.2 | Payment Processing | Track outstanding payments | Open item past its net due date | 9 Cash Application & Collections |

## The steps the Control Tower itself covers

| L4 | L3 process | Step | What your agent does |
|---|---|---|---|
| 7.1.1 | Revenue Recognition | Recognise revenue on delivered goods | Reports goods that left the warehouse but carry no invoice: revenue that is not on the books |
| 7.2.1 | Financial Reporting | Reports on sales, revenue and receivables | KPI snapshot: unbilled shipped value, POD-pending value, block ageing, overdue receivables, DSO drivers |
| 7.2.2 | Financial Reporting | Analyse O2C performance, support decisions | Answers management questions; writes the close-readiness memo; routes each finding |

Step IDs are stable: use them in your findings, routing notes and dashboard so every team reads the same language.
