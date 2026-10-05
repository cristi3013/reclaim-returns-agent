# Control Tower: the reads the gateway needs

For Alex. Six **read-only** OData v4 functions on the CAP gateway (`/odata/v4/returns`), same style as `getInvoice`:
GET, parameters in the URL, answer wrapped as `{ "value": "<json string>" }` (or a plain object; we handle both).
No action, no POST: the Control Tower must have no write path. The response shapes below are the ones of the
organizers' MCP tools (their mock pack), so the Reclaim loader reads live answers unchanged.

Every answer carries two extra fields we show in the request log:

```json
{ "underlyingRequests": ["GET /sap/opu/odata/sap/..."], "capturedOn": "2026-10-06", "response": { ...as below... } }
```

Dates as `YYYY-MM-DD` (convert `/Date(ms)/`), amounts and quantities as strings like `"10800.00"`, keep the
currency next to every amount. Strip leading zeros from document numbers. Add `sap-client=100`.

## 1 · listUnbilledDeliveries(top, soldToParty?)

S/4: `API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader?$filter=OverallGoodsMovementStatus eq 'C' and (OverallDelivReltdBillgStatus eq 'A' or OverallDelivReltdBillgStatus eq 'B')[ and SoldToParty eq '<soldToParty>']&$orderby=ActualGoodsMovementDate asc&$top=<top>`
Page with `$skip` until a page comes back short; `top` up to 500. `count` = rows returned.

```json
{ "count": 178, "deliveries": [ { "DeliveryDocument": "80000033", "SoldToParty": "10021", "ShipToParty": "10021",
  "ActualGoodsMovementDate": "2019-03-13", "OverallDelivReltdBillgStatus": "A", "DeliveryBlockReason": "",
  "SalesOrganization": "YSOD", "daysSinceGoodsIssue": 2759 } ] }
```

## 2 · listDeliveriesAwaitingPod(top, shipToParty?)

S/4: same entity set, `$filter=OverallGoodsMovementStatus eq 'C' and (OverallProofOfDeliveryStatus eq 'A' or OverallProofOfDeliveryStatus eq 'B') and ActualGoodsMovementDate le datetime'<today minus 3 days>T00:00:00'[ and ShipToParty eq '<shipToParty>']&$orderby=ActualGoodsMovementDate asc`

```json
{ "count": 80, "deliveries": [ { "DeliveryDocument": "80000271", "ShipToParty": "10172",
  "ActualGoodsMovementDate": "2021-04-16", "daysSinceGoodsIssue": 1994,
  "podFields": { "OverallProofOfDeliveryStatus": "B", "ProofOfDeliveryDate": null } } ] }
```

## 3 · listBlockedOrders(top)

S/4: `API_SALES_ORDER_SRV/A_SalesOrder?$filter=HeaderBillingBlockReason ne '' or DeliveryBlockReason ne '' or TotalCreditCheckStatus eq 'B'&$orderby=TotalNetAmount desc&$top=<top>` (page; the full list is 144 today).

```json
{ "count": 144, "orders": [ { "SalesOrder": "1667", "SalesOrderType": "YOR", "SalesOrganization": "YSOD",
  "SoldToParty": "10021", "CreationDate": "2026-09-29", "TotalNetAmount": "270000.00", "TransactionCurrency": "EUR",
  "HeaderBillingBlockReason": "", "DeliveryBlockReason": "01", "OverallSDProcessStatus": "A",
  "TotalCreditCheckStatus": "" } ] }
```

## 4 · listOverdueReceivables(companyCode, keyDate)

One call per company code (`YDE1` → EUR, `YRO1` → RON). S/4: `FAR_CUSTOMER_LINE_ITEMS/Items?$filter=KeyDate eq datetime'<keyDate>T00:00:00' and CompanyCode eq '<cc>' and NetDueDate lt datetime'<keyDate>T00:00:00' and (HasClearingAccountingDocument eq '' or ClearingDate gt datetime'<keyDate>T00:00:00')&$select=Customer,AmountInCompanyCodeCurrency,CompanyCodeCurrency`
Sum per customer, sort by amount descending.

```json
{ "asOf": "2026-10-06", "overdueReceivables": { "total": 368598.40, "currency": "EUR",
  "topCustomers": [ { "Customer": "10021", "AmountInCompanyCodeCurrency": "318508.40", "CompanyCodeCurrency": "EUR" } ] } }
```

## 5 · listBillingDueList(soldToParty, top)

S/4: `SD_CUSTOMER_INVOICES_CREATE/C_BillingDueListItem_F0798?$filter=SoldToParty eq '<soldToParty>'&$top=<top>`
(this service answers 500 to `$orderby`: do not sort server-side).

```json
{ "total": 47, "items": [ { "ReferenceSDDocument": "80609017", "NetAmount": "680.00", "TransactionCurrency": "EUR",
  "HasError": false, "BillingDocumentDate": "2026-09-03", "SoldToParty": "10044" } ] }
```

## 6 · getCustomerAddresses(partners)  — `partners` comma-separated

S/4: `API_BUSINESS_PARTNER/A_BusinessPartnerAddress?$filter=BusinessPartner eq '10044' or ...&$select=BusinessPartner,Country,CityName`
and `A_BusinessPartner?$select=BusinessPartner,BusinessPartnerFullName`. Also run `Country eq 'NO'` and return the (empty) list as `norway`.

```json
{ "addresses": [ { "BusinessPartner": "10044", "CityName": "Berlin", "Country": "DE" } ],
  "names": [ { "BusinessPartner": "10044", "BusinessPartnerFullName": "XYZ Partner Limited" } ],
  "norway": [], "noAddressOnDS4": ["46", "51"] }
```

## 7 · checkOrderConformance(salesOrder)  — optional, nice for the questions about orders 1876 / 1937

Three reads: `API_SALES_ORDER_SRV/A_SalesOrder('<n>')`, `API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryItem?$filter=ReferenceSDDocument eq '<n>'`, `API_BILLING_DOCUMENT_SRV/A_BillingDocumentItem?$filter=SalesDocument eq '<n>'`.

```json
{ "salesOrder": "1876", "conforms": false, "deliveries": ["80608983"], "billingDocuments": [],
  "findings": [ { "severity": "high", "l4": "4.1.1", "step": "Invoice Creation: Create billing document (VF01) based on delivery",
    "finding": "Delivered but not billed: revenue leakage risk.", "routeTo": "billing" } ] }
```
Rules: no delivery → conforms (nothing to deviate yet); delivery without invoice → 4.1.1 `billing`; credit block
(`TotalCreditCheckStatus` = B) → 2.3.3 `blocks`. We apply the 3-day grace on our side.

## How Reclaim uses them

- In SAP mode **DS4** the Control Tower reads these functions; in **Mock** it reads the organizers' pack of 1 Oct 2026.
- A function that is missing or fails makes that section "not read" in the memo; the run continues. Nothing is guessed.
- Reads only. If a function ever writes, the Control Tower's promise on stage is broken.

## Quick test from a terminal

```
G=https://o2c-returns-agent.cfapps.ap21.hana.ondemand.com/odata/v4/returns
curl "$G/listUnbilledDeliveries(top=500)"
curl "$G/listDeliveriesAwaitingPod(top=500)"
curl "$G/listBlockedOrders(top=500)"
curl "$G/listOverdueReceivables(companyCode='YDE1',keyDate='2026-10-06')"
curl "$G/listBillingDueList(soldToParty='10044',top=100)"
curl "$G/getCustomerAddresses(partners='10021,10044,10057,10020,10012,10100,10101,10110,10172,10220,62,46,51')"
curl "$G/checkOrderConformance(salesOrder='1876')"
```
