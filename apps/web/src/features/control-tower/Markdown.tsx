import { Fragment } from 'react'

/** Just enough markdown for the close memo: headings, tables, lists, bold, paragraphs. No HTML passes through. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g)
    return parts.map((p, k) => (p.startsWith('**') && p.endsWith('**') ? <strong key={k}>{p.slice(2, -2)}</strong> : <Fragment key={k}>{p}</Fragment>))
  }
  while (i < lines.length) {
    const l = lines[i]!
    if (l.startsWith('# ')) out.push(<h2 key={i} className="mt-2 text-lg font-semibold">{inline(l.slice(2))}</h2>)
    else if (l.startsWith('## ')) out.push(<h3 key={i} className="mt-5 text-sm font-semibold uppercase tracking-wider text-muted">{inline(l.slice(3))}</h3>)
    else if (l.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.startsWith('|')) {
        const cells = lines[i]!.split('|').slice(1, -1).map((c) => c.trim())
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells)
        i++
      }
      out.push(
        <div key={i} className="my-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted">
              <tr>{rows[0]?.map((c, k) => <th key={k} className="py-1 pr-3 font-medium">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>{rows.slice(1).map((r, ri) => <tr key={ri} className="border-t border-line">{r.map((c, k) => <td key={k} className="py-1 pr-3 align-top">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    } else if (/^\s*(-|\d+\.)\s/.test(l)) {
      const items: string[] = []
      while (i < lines.length && /^\s*(-|\d+\.)\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*(-|\d+\.)\s/, ''))
        i++
      }
      out.push(<ul key={i} className="my-1 list-disc space-y-0.5 pl-5 text-sm">{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ul>)
      continue
    } else if (l.trim()) out.push(<p key={i} className="my-1 text-sm">{inline(l)}</p>)
    i++
  }
  return <div className="min-w-0">{out}</div>
}
