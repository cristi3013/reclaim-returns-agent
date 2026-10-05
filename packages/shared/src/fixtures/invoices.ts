import type { InvoiceSnapshot } from '../schemas'

/**
 * Invoices as DS4 returned them on 1 Oct 2026 (90000353 and 354 are captured; the others follow
 * expected-results.json). Customer 10021, sales area YSOD/Y1/Y5, company code YDE1, material 54 at 270 EUR/KG.
 */
const mk = (
  number: string,
  quantity: number,
  order: string,
  delivery: string,
  plant = 'YGLG',
  date = '2026-09-29',
  etagTs = '2026-09-29T10:06:03.0155740Z',
): InvoiceSnapshot => ({
  number,
  date,
  customer: '10021',
  customerName: 'Cust DE 1',
  salesOrg: 'YSOD',
  distributionChannel: 'Y1',
  division: 'Y5',
  companyCode: 'YDE1',
  currency: 'EUR',
  totalNetAmount: quantity * 270,
  etag: `W/"datetimeoffset'${etagTs}'"`,
  items: [
    {
      item: '10',
      material: '54',
      description: 'Soda material (HAWA) - RO, DE, CH Plant',
      quantity,
      unit: 'KG',
      netAmount: quantity * 270,
      unitPrice: 270,
      plant,
      salesOrder: order,
      delivery,
    },
  ],
})

export const INVOICES: Record<string, InvoiceSnapshot> = {
  '90000353': mk('90000353', 5, '1610', '80608800'),
  '90000354': mk('90000354', 12, '1611', '80608801', 'YGLG', '2026-09-29', '2026-09-29T10:08:00.7329060Z'),
  '90000355': mk('90000355', 20, '1612', '80608802'),
  '90000356': mk('90000356', 8, '1613', '80608803'),
  '90000357': mk('90000357', 15, '1614', '80608804'),
  '90000358': mk('90000358', 5, '1615', '80608805'),
  '90000359': mk('90000359', 10, '1616', '80608806', 'YRO1', '2026-09-30', '2026-09-30T08:12:41.0000000Z'),
}

/** Plant to company code. Not in SAP's released APIs; the guide hints at a reference table. */
export const PLANT_COMPANY: Record<string, string> = { YGLG: 'YDE1', YRO1: 'YRO1' }

/** Agreed price on file: condition PR00 for material 54 in YSOD/Y1. */
export const AGREED_PRICE = {
  material: '54',
  salesOrg: 'YSOD',
  channel: 'Y1',
  conditionType: 'PR00',
  unitPrice: 270,
  unit: 'KG',
  currency: 'EUR',
}
