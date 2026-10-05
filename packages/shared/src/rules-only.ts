import type { Case, Facts } from './schemas'
import { complaintText } from './thread'

/** Rules-only extraction: no model, just patterns. Enough for the demo emails, honest about its limits. */
export function regexFacts(c: Case): Facts {
  // The complaint plus what the customer added in replies (an invoice number they were asked for, say).
  const body = complaintText(c)
  const text = `${c.subject}\n${body}`
  const inv = text.match(/\b(9000\d{4})\b/)?.[1] ?? null
  // The quantity the customer complains about: prefer a "N KG" that sits next to a complaint word
  // ("2 KG are lost", "return 10 KG", "3 KG crushed"), else the last quantity mentioned.
  const all = [...body.matchAll(/(\d+(?:[.,]\d+)?)\s*KG/gi)]
  const near = (m: RegExpMatchArray) => body.slice(Math.max(0, (m.index ?? 0) - 10), (m.index ?? 0) + m[0].length + 16).toLowerCase()
  const qty =
    all.find((m) => /missing|lost|damag|crush|leak|contaminat|return|credit|discolou?r/.test(near(m))) ?? all[all.length - 1] ?? null
  const t = body.toLowerCase()
  const wantsReplacement = /replace/i.test(body) && /do not want a credit/i.test(body)
  const type: Facts['complaintType'] = /^re:/i.test(c.subject)
    ? 'follow_up'
    : wantsReplacement
      ? 'ruined'
      : t.includes('leak')
        ? 'damaged'
        : t.includes('crushed') || t.includes('damaged')
          ? 'damaged'
          : t.includes('only') && t.includes('arrived')
            ? 'short_delivery'
            : t.includes('price')
              ? 'price'
              : t.includes('quality') || t.includes('discolour') || t.includes('contaminat')
                ? 'quality'
                : 'unknown'
  const price = body.match(/agreed price is (\d+(?:[.,]\d+)?)/i)
  return {
    invoiceNumber: inv,
    material: /material 54/i.test(body) ? '54' : null,
    claimedQuantity: qty ? Number(qty[1]!.replace(',', '.')) : null,
    unit: 'KG',
    complaintType: type,
    claimedUnitPrice: price ? Number(price[1]!.replace(',', '.')) : null,
    wantsReplacement,
    goodsReturnable: t.includes('leak') ? false : t.includes('collected') ? true : null,
    evidence: 'extracted by pattern rules (rules-only mode)',
    language: 'en',
  }
}

