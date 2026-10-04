/** 4 050.00 EUR: thin-space thousands, two decimals, currency after, as SAP GUI shows it. */
export function formatMoney(n: number, currency = 'EUR'): string {
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${n < 0 ? '-' : ''}${grouped}.${dec} ${currency}`
}

export function formatQty(n: number, unit: string | null): string {
  const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
  return unit ? `${s} ${unit}` : s
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 05 Oct 2026, in UTC so the demo reads the same on every machine. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${formatDate(iso)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export function formatRelative(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
