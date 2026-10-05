import type { Facts, InvoiceSnapshot } from './schemas'

/**
 * Orders candidate invoices for a complaint that names no invoice number (R9).
 * 1. lines whose quantity equals the claimed quantity first,
 * 2. then invoices dated within the last 14 days before the email ("last week"),
 * 3. then the lowest document number (the earliest created), which is what the organizers' oracle picks.
 * The person still confirms; this only decides what is proposed and in which order the rest are shown.
 */
export function rankCandidates(invoices: InvoiceSnapshot[], facts: Facts, receivedAt: string, limit = 5): InvoiceSnapshot[] {
  const received = new Date(receivedAt).getTime()
  const score = (i: InvoiceSnapshot) => {
    const line = i.items.find((it) => !facts.material || it.material === facts.material) ?? i.items[0]
    const qtyMatch = facts.claimedQuantity != null && line && Math.abs(line.quantity - facts.claimedQuantity) < 0.0005 ? 0 : 1
    const age = received - new Date(i.date).getTime()
    const recent = age >= 0 && age <= 14 * 86400000 ? 0 : 1
    return { qtyMatch, recent }
  }
  return [...invoices]
    .filter((i) => i.items.length > 0 && (!facts.material || i.items.some((it) => it.material === facts.material)))
    .sort((a, b) => {
      const sa = score(a)
      const sb = score(b)
      return sa.qtyMatch - sb.qtyMatch || sa.recent - sb.recent || a.number.localeCompare(b.number)
    })
    .slice(0, limit)
}
