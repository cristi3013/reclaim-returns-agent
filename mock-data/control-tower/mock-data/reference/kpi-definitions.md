# KPI definitions (mock, for the hackathon)

Your agent computes these from SAP reads. Every KPI is shown **per currency** (EUR for company code YDE1 / sales org YSOD, RON for YRO1 / YSOR): never add EUR and RON.
"Today" is the run date. Ages are in calendar days.

| KPI | Definition | SAP source | Value | Grace / severity (suggested) |
|---|---|---|---|---|
| **Unbilled shipped value** | Deliveries with goods issue posted (`OverallGoodsMovementStatus` = `C`) and not (fully) billed (`OverallDelivReltdBillgStatus` = `A` or `B`) | `API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader` | Delivery headers carry no value: take `NetAmount` from the billing due list (`SD_CUSTOMER_INVOICES_CREATE/C_BillingDueListItem_F0798`), else pro rata from the order item (net value ÷ ordered qty × delivered qty) | Leak after 3 days; high after 14 days |
| **POD-pending value** | Goods-issued deliveries that are POD-relevant and whose POD is still open (`OverallProofOfDeliveryStatus` = `A` or `B`) | same entity set | `NetAmount` from the billing due list (on DS4 it lists POD-pending deliveries too), else order pro rata | Chase after 3 days; high after 14 days |
| **Block ageing** | Orders with a billing block (`HeaderBillingBlockReason` ≠ ''), delivery block (`DeliveryBlockReason` ≠ '') or credit block (`TotalCreditCheckStatus` = `B`), by age since creation | `API_SALES_ORDER_SRV/A_SalesOrder` | `TotalNetAmount` = value at risk | Buckets 0–7 / 8–30 / 31+ days; high after 30 days |
| **Overdue receivables** | Open items whose net due date is before today, per customer and company code | `FAR_CUSTOMER_LINE_ITEMS/Items` (Fiori *Manage Customer Line Items*, GUI `FBL5N`) | `AmountInCompanyCodeCurrency` | High from 10 000 per customer in company-code currency |
| **Returns without credit** | Customer returns (`YRE`) older than 7 days that no credit memo references | `API_CUSTOMER_RETURN_SRV`, `API_BILLING_DOCUMENT_SRV` | Return net value | Medium |
| **Conformance rate** | Share of recent orders whose document flow has no high/medium deviation | `s4_check_order_conformance` (order → deliveries → invoices) | count | Deviations counted per L4 step |
| **DSO** (days sales outstanding) | Open receivables ÷ revenue of the period × days in the period | AR open items + revenue per period from FI | days | Exact DSO needs revenue per period from finance; explain movement through its drivers (below) |

## DSO drivers (how to answer "why is DSO up?")

DSO rises when money is owed longer, or when invoices go out later than they could:

1. **Overdue receivables** raise DSO directly (route to 9 Cash Application & Collections).
2. **Unbilled shipped value** and **POD-pending value** delay the invoice, so the payment clock starts late (route to 7 and 6).
3. **Billing blocks** on delivered orders delay the invoice (route to 3).

Answer with the breakdown per driver for the subject (country or customer), with value, count and the top documents. If there is no finding for the subject, say so: the cause is outside the O2C documents, for a person.

## Counting rules

- One delivery that is both unbilled and POD-pending is **one** leak (cause: POD), not two. Count its value once.
- A list that returns exactly its row cap (100 by default) is incomplete: page with `$skip`, or narrow by customer or date.
- Separate the **current period** (goods issue in the closing month) from **legacy** items (older than a year): legacy items are reported, but they do not decide this month's close.
