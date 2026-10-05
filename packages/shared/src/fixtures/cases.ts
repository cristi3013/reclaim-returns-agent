import type { Attachment, Case, ExistingDoc, Facts } from '../schemas'

export interface FixtureCase {
  id: string
  emailFile: string
  receivedAt: string
  from: string
  subject: string
  bodyText: string
  attachments: Attachment[]
  /** What the extraction model reads out of the email. */
  facts: Facts
  /** Which invoices the lookups find. */
  invoiceNumbers: string[]
  /** Candidates for the invoice search when no number is named (R9). */
  candidateInvoices: string[]
  /** Documents that already exist in SAP before the case runs. */
  existingCredits: ExistingDoc[]
}

const F = (p: Partial<Facts>): Facts => ({
  invoiceNumber: null,
  material: '54',
  claimedQuantity: null,
  unit: 'KG',
  complaintType: 'unknown',
  claimedUnitPrice: null,
  wantsReplacement: false,
  goodsReturnable: null,
  evidence: '',
  language: 'en',
  ...p,
})

/** The seven organizer emails (bodies verbatim) plus our intercompany case. */
export const FIXTURES: FixtureCase[] = [
  {
    id: 'case-01',
    emailFile: '01-complaint-damaged.eml',
    receivedAt: '2026-10-05T07:30:00Z',
    from: 'Quality, Cust DE 1 <quality@cust-de-1.example>',
    subject: 'Complaint on invoice 90000353 – damaged drums',
    bodyText:
      'Hello,\n\nTwo of the drums delivered with invoice 90000353 (item 10, material 54, 5 KG in total) arrived\ndamaged and leaking: 2 KG are lost. Photo attached. Please credit or replace.\n\nRegards,\nQuality department, Cust DE 1',
    attachments: [
      { name: 'damaged-drums-90000353.png', mimeType: 'image/png', url: '/mock/damaged-drums-90000353.png' },
    ],
    facts: F({
      invoiceNumber: '90000353',
      claimedQuantity: 2,
      complaintType: 'damaged',
      goodsReturnable: false,
      evidence: 'two drums leaking, 2 KG lost, photo shows a puddle under the middle drum',
    }),
    invoiceNumbers: ['90000353'],
    candidateInvoices: [],
    existingCredits: [],
  },
  {
    id: 'case-02',
    emailFile: '02-complaint-price.eml',
    receivedAt: '2026-10-05T07:40:00Z',
    from: 'Accounts Payable, Cust DE 1 <ap@cust-de-1.example>',
    subject: 'Price difference on invoice 90000354',
    bodyText:
      'Hello,\n\nWe were invoiced 3 240.00 EUR for 12 KG of material 54 on invoice 90000354.\nOur agreed price is 260 EUR per KG, so we expect 3 120.00 EUR. Please issue a credit note for the difference.\n\nAccounts Payable, Cust DE 1',
    attachments: [],
    facts: F({
      invoiceNumber: '90000354',
      claimedQuantity: 12,
      complaintType: 'price',
      claimedUnitPrice: 260,
      evidence: 'claims agreed price 260 EUR/KG, expects 3 120.00 EUR instead of 3 240.00 EUR',
    }),
    invoiceNumbers: ['90000354'],
    candidateInvoices: [],
    existingCredits: [],
  },
  {
    id: 'case-03',
    emailFile: '03-complaint-short-delivery.eml',
    receivedAt: '2026-10-05T07:50:00Z',
    from: 'Warehouse, Cust DE 1 <warehouse@cust-de-1.example>',
    subject: 'Short delivery – invoice 90000355',
    bodyText:
      'Hello,\n\nInvoice 90000355 charges 20 KG of material 54 but only 18 KG arrived. Please credit the 2 KG missing.\n\nWarehouse, Cust DE 1',
    attachments: [],
    facts: F({
      invoiceNumber: '90000355',
      claimedQuantity: 2,
      complaintType: 'short_delivery',
      evidence: '20 KG invoiced, 18 KG arrived',
    }),
    invoiceNumbers: ['90000355'],
    candidateInvoices: [],
    existingCredits: [],
  },
  {
    id: 'case-04',
    emailFile: '04-complaint-over-quantity.eml',
    receivedAt: '2026-10-05T08:00:00Z',
    from: 'Quality, Cust DE 1 <quality@cust-de-1.example>',
    subject: 'Return 10 KG – invoice 90000356',
    bodyText:
      'Hello,\n\nWe want to return 10 KG of material 54 from invoice 90000356 – quality not as expected.\n\nQuality department, Cust DE 1',
    attachments: [],
    facts: F({
      invoiceNumber: '90000356',
      claimedQuantity: 10,
      complaintType: 'quality',
      goodsReturnable: true,
      evidence: 'quality not as expected',
    }),
    invoiceNumbers: ['90000356'],
    candidateInvoices: [],
    existingCredits: [],
  },
  {
    id: 'case-05',
    emailFile: '05-complaint-no-invoice.eml',
    receivedAt: '2026-10-05T08:10:00Z',
    from: 'Quality, Cust DE 1 <quality@cust-de-1.example>',
    subject: 'Bad batch received last week',
    bodyText:
      'Hello,\n\nThe 15 KG of material 54 we received last week is discoloured. We do not want to use it.\nPlease take it back and credit us.\n\nQuality department, Cust DE 1',
    attachments: [],
    facts: F({
      invoiceNumber: null,
      claimedQuantity: 15,
      complaintType: 'quality',
      goodsReturnable: true,
      evidence: 'discoloured material, received last week, no invoice number given',
    }),
    invoiceNumbers: [],
    candidateInvoices: ['90000357'],
    existingCredits: [],
  },
  {
    id: 'case-06',
    emailFile: '06-complaint-duplicate.eml',
    receivedAt: '2026-10-06T07:30:00Z',
    from: 'Quality, Cust DE 1 <quality@cust-de-1.example>',
    subject: 'RE: Complaint on invoice 90000353 – damaged drums',
    bodyText:
      'Hello,\n\nAny news on our complaint about invoice 90000353 (2 KG leaking)? Please confirm the credit.\n\nQuality department, Cust DE 1',
    attachments: [],
    facts: F({
      invoiceNumber: '90000353',
      claimedQuantity: 2,
      complaintType: 'follow_up',
      goodsReturnable: false,
      evidence: 'follow-up on the earlier leaking-drums complaint',
    }),
    invoiceNumbers: ['90000353'],
    candidateInvoices: [],
    existingCredits: [],
  },
  {
    id: 'case-07',
    emailFile: '07-replacement-request.eml',
    receivedAt: '2026-10-05T08:30:00Z',
    from: 'Quality, Cust DE 1 <quality@cust-de-1.example>',
    subject: 'Replacement needed – invoice 90000358',
    bodyText:
      'Hello,\n\n5 KG of material 54 from invoice 90000358 are contaminated. We do not want a credit:\nplease replace them with a new delivery as soon as possible and collect the bad goods.\n\nQuality department, Cust DE 1',
    attachments: [],
    facts: F({
      invoiceNumber: '90000358',
      claimedQuantity: 5,
      complaintType: 'ruined',
      wantsReplacement: true,
      goodsReturnable: true,
      evidence: 'contaminated; customer explicitly wants a replacement, not a credit',
    }),
    invoiceNumbers: ['90000358'],
    candidateInvoices: [],
    existingCredits: [],
  },
  {
    id: 'case-08',
    emailFile: '08-intercompany.eml',
    receivedAt: '2026-10-05T09:00:00Z',
    from: 'Logistics, Cust DE 1 <logistics@cust-de-1.example>',
    subject: 'Damaged pallet – invoice 90000359',
    bodyText:
      'Hello,\n\nOn invoice 90000359 (10 KG of material 54, shipped from your Romanian plant) one pallet arrived with 3 KG of drums crushed. The drums are intact enough to be collected. Please take them back and credit us.\n\nLogistics, Cust DE 1',
    attachments: [],
    facts: F({
      invoiceNumber: '90000359',
      claimedQuantity: 3,
      complaintType: 'damaged',
      goodsReturnable: true,
      evidence: '3 KG crushed on one pallet; drums can be collected',
    }),
    invoiceNumbers: ['90000359'],
    candidateInvoices: [],
    existingCredits: [],
  },
]

export function buildFixtureCases(): Case[] {
  const now = new Date().toISOString()
  return FIXTURES.map((f) => ({
    id: f.id,
    emailFile: f.emailFile,
    receivedAt: f.receivedAt,
    from: f.from,
    subject: f.subject,
    bodyText: f.bodyText,
    attachments: f.attachments,
    status: 'received',
    customer: '10021',
    customerName: 'Cust DE 1',
    invoiceNumber: f.facts.invoiceNumber,
    complaintType: 'unknown',
    aiMode: 'assisted',
    facts: null,
    findings: null,
    proposals: [],
    approvals: [],
    sapDocuments: [],
    events: [],
    anomalies: [],
    createdAt: now,
    updatedAt: now,
  }))
}
