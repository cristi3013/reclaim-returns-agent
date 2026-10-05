import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useIngest } from '@/api'
import { Button } from '@/components/ui/button'
import { COMPLAINT_EXAMPLES } from './examples'
import { buildEml, fileToAttachment } from './eml'

/**
 * Writes a complaint by hand and ingests it as an .eml, so a case can be created for any invoice,
 * including the team's own DS4 invoices that have no demo email.
 */
export function NewComplaintDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ingest = useIngest()
  const first = COMPLAINT_EXAMPLES[0]!
  const [example, setExample] = useState(first.id)
  const [from, setFrom] = useState(first.from)
  const [subject, setSubject] = useState(first.subject)
  const [body, setBody] = useState(first.body)
  // Evidence: a photo of the damage, or the signed delivery note. Rules R3 and R5 need it, and the gateway checks.
  const [files, setFiles] = useState<File[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const chosen = COMPLAINT_EXAMPLES.find((e) => e.id === example)
  const pick = (id: string) => {
    const e = COMPLAINT_EXAMPLES.find((x) => x.id === id)
    setExample(id)
    if (!e) return
    setFrom(e.from)
    setSubject(e.subject)
    setBody(e.body)
  }
  if (!open) return null
  const submit = async () => {
    const attachments = await Promise.all(files.map(fileToAttachment))
    const eml = buildEml({ from, subject, body, attachments })
    const file = new File([eml], `manual-${Date.now()}.eml`, { type: 'message/rfc822' })
    ingest.mutate([file], {
      onSuccess: () => {
        toast.success('Complaint added to the inbox')
        onClose()
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the complaint'),
    })
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="New complaint" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-2xl rounded-lg border border-line bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold">New complaint</h2>
        <p className="mt-1 text-sm text-muted">
          Write the email a customer would send. It is ingested like an .eml from the returns mailbox. Use one of the team's DS4 invoices to see a real write.
        </p>
        <div className="mt-4 grid gap-3">
          <label className="text-sm">
            Start from an example (team invoices on DS4)
            <select value={example} onChange={(e) => pick(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2">
              {COMPLAINT_EXAMPLES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
              <option value="">Blank</option>
            </select>
            {chosen && <span className="mt-1 block text-xs text-muted">Expected: {chosen.expect}</span>}
          </label>
          <label className="text-sm">
            From
            <input value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-3" />
          </label>
          <label className="text-sm">
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-3" />
          </label>
          <label className="text-sm">
            Body
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="mt-1 w-full rounded-md border border-line bg-surface p-3 font-sans" />
          </label>
          <label className="text-sm">
            Evidence <span className="text-xs text-muted">(photo of the damage or the signed delivery note; needed for a credit-only claim or a short delivery)</span>
            <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1 file:text-sm file:text-fg" />
            {files.length > 0 && <span className="mt-1 block text-xs text-muted">{files.map((f) => f.name).join(', ')}</span>}
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={ingest.isPending || !subject.trim() || !body.trim()}>
            {ingest.isPending ? 'Adding…' : 'Add to inbox'}
          </Button>
        </div>
      </div>
    </div>
  )
}
