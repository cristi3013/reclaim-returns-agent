import type { Decision, InvoiceSnapshot } from './schemas'
import { BILLING_BLOCK } from './policy'

/**
 * The exact body sent to the SAP gateway after approval. Built by code from the decision,
 * never by the model, and sent unchanged. Shapes follow the DS4 OData APIs in the hackathon guide.
 */
export function buildSapPayload(
  d: Decision,
  inv: InvoiceSnapshot,
  complaintRef: string,
): Record<string, unknown> | null {
  if (d.documentType === 'NONE') return null
  const item = inv.items[0]!
  const items = [
    {
      Material: item.material,
      RequestedQuantity: String(d.quantity),
      RequestedQuantityUnit: item.unit,
      ReferenceSDDocument: inv.number,
      ReferenceSDDocumentItem: item.item,
    },
  ]
  const common = {
    SalesOrganization: inv.salesOrg,
    DistributionChannel: inv.distributionChannel,
    OrganizationDivision: inv.division,
    SoldToParty: inv.customer,
    SDDocumentReason: d.reasonCode,
    PurchaseOrderByCustomer: complaintRef,
  }
  if (d.documentType === 'YRE') {
    return { CustomerReturnType: 'YRE', ...common, to_Item: items }
  }
  return {
    CreditMemoRequestType: 'YCR',
    ...common,
    HeaderBillingBlockReason: BILLING_BLOCK,
    ReferenceSDDocument: inv.number,
    to_Item: items,
  }
}
