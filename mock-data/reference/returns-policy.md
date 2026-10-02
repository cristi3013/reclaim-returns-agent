# Returns policy (mock, for the hackathon)

Your agent applies these rules and cites the rule number in every proposal.

| # | Situation | Decision | SAP document | Order reason |
|---|---|---|---|---|
| R1 | Goods damaged in transit, customer can return them | Return the damaged quantity; credit after the goods are received | Customer return (YRE) | 102 |
| R2 | Poor quality / defective, customer can return them | Return; credit after receipt | Customer return (YRE) | 101 |
| R3 | Goods ruined, cannot be returned (leaked, contaminated, destroyed) | Credit only, with photo evidence | Credit memo request (YCR) | 104 |
| R4 | Price higher than agreed | Credit the difference only, after checking the agreed price (PR00) | Credit memo request (YCR) | 101 (or the reason your team agrees) |
| R5 | Short delivery (less arrived than invoiced) | Credit the missing quantity; ask the warehouse to check proof of delivery | Credit memo request (YCR) | 103 |
| R6 | Customer asks for a replacement | Do not create a credit; hand over to customer service for a free re-delivery | none (flag) | – |
| R7 | Claimed quantity or amount exceeds the invoice | Refuse; ask the customer to correct | none | – |
| R8 | Same complaint already handled (a return or credit exists for the invoice) | Do not create a second document; answer with the existing number | none | – |
| R9 | Invoice not named | Search the customer's invoices for material and date; propose the match; ask the customer to confirm | none until confirmed | – |

**Leaked or damaged goods (R1 or R3).** Whether the goods can come back is a judgement call. The agent proposes both paths with its reasoning: R1 (return, credit after receipt) and R3 (credit only, with photo evidence). A person confirms one. Your team decides which path the agent recommends by default.

**Price complaints (R4).** If the invoiced price equals the agreed PR00 price, there is no credit. The agent drafts a reply that shows the agreed price. It creates a credit memo request only when a person confirms a special agreement.

## Approval

| Credit value (EUR) | Approver |
|---|---|
| up to 500 | Customer service lead |
| 500 – 5 000 | Credit manager |
| above 5 000 | Finance director |
| any credit without goods coming back (R3, R4, R5) | Credit manager at least |

Every return and credit memo request is created with billing block **08** (*Check Credit Memo*). Only the approver's decision removes it.

## Intercompany

If the selling company code differs from the company code of the delivering plant, flag an intercompany credit for finance.
