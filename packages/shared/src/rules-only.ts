import type { Case, Facts } from './schemas'

/** Rules-only extraction: no model, just patterns. Enough for the demo emails, honest about its limits. */
export function regexFacts(c: Case): Facts {
  const text = `${c.subject}\n${c.bodyText}`
  const inv = text.match(/\b(9000\d{4})\b/)?.[1] ?? null
  const qty = c.bodyText.match(/(\d+(?:[.,]\d+)?)\s*KG/i)
  const t = c.bodyText.toLowerCase()
  const wantsReplacement = /replace/i.test(c.bodyText) && /do not want a credit/i.test(c.bodyText)
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
  const price = c.bodyText.match(/agreed price is (\d+(?:[.,]\d+)?)/i)
  return {
    invoiceNumber: inv,
    material: /material 54/i.test(c.bodyText) ? '54' : null,
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

