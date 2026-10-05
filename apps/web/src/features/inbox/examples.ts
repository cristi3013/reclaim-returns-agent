import { TEAM_INVOICES } from '@reclaim/shared'

export interface ComplaintExample {
  id: string
  label: string
  invoice: string
  from: string
  subject: string
  body: string
  /** What the agent should propose, for the person driving the demo. */
  expect: string
}

const quality = 'Quality, Cust DE 1 <quality@cust-de-1.example>'

/** Ready-made complaints against the team's own DS4 invoices: each one exercises a different write path for real. */
export const COMPLAINT_EXAMPLES: ComplaintExample[] = [
  {
    id: 'short-delivery',
    label: 'Short delivery on 90000377 (credit request, rule R5)',
    invoice: '90000377',
    from: 'Warehouse, Cust DE 1 <warehouse@cust-de-1.example>',
    subject: 'Short delivery – invoice 90000377',
    body: 'Hello,\n\nInvoice 90000377 charges 15 KG of material 54, but our goods receipt on 29 September counted only 13 KG. 2 KG are missing. Please credit the missing quantity.\n\nRegards,\nWarehouse, Cust DE 1',
    expect: 'YCR with order reason 103 for 2 KG = 540 EUR, billing block 08, credit manager. Release it afterwards: that is the guide\'s check 6.',
  },
  {
    id: 'damaged-collectable',
    label: 'Damaged in transit on 90000378 (return, rule R1)',
    invoice: '90000378',
    from: 'Logistics, Cust DE 1 <logistics@cust-de-1.example>',
    subject: 'Damaged pallet – invoice 90000378',
    body: 'Hello,\n\nThree drums from invoice 90000378 (material 54) arrived with the pallet crushed; 3 KG are unusable. The drums are intact enough to be collected, please arrange the pickup and credit the 3 KG.\n\nRegards,\nLogistics, Cust DE 1',
    expect: 'Two options: a return (YRE, reason 102) for 3 KG = 810 EUR recommended, or a credit-only (YCR, reason 104). Credit manager.',
  },
  {
    id: 'defective',
    label: 'Defective batch on 90000379 (return, rule R2)',
    invoice: '90000379',
    from: quality,
    subject: 'Quality complaint – invoice 90000379',
    body: 'Hello,\n\nThe batch delivered with invoice 90000379 (10 KG of material 54) is off specification: viscosity is far outside the agreed range and the material cannot be used. We can send the full 10 KG back. Please arrange the return and credit.\n\nRegards,\nQuality department, Cust DE 1',
    expect: 'YRE with order reason 101 for 10 KG = 2700 EUR, credit manager.',
  },
]

/** Every example targets a team invoice, never a shared demo one. */
export const examplesTargetTeamInvoices = () => COMPLAINT_EXAMPLES.every((e) => TEAM_INVOICES.includes(e.invoice) && e.subject.includes(e.invoice) && e.body.includes(e.invoice))
