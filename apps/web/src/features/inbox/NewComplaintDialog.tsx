import { useState } from 'react'
import { toast } from 'sonner'
import { useIngest } from '@/api'
import { Button } from '@/components/ui/button'

/**
 * Writes a complaint by hand and ingests it as an .eml, so a case can be created for any invoice,
 * including the team's own DS4 invoices that have no demo email.
 */
export function NewComplaintDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ingest = useIngest()
  const [from, setFrom] = useState('Quality, Cust DE 1 <quality@cust-de-1.example>')
  const [subject, setSubject] = useState('Complaint on invoice 90000363 – damaged drums')
  const [body, setBody] = useState(
    'Hello,\n\nTwo of the drums delivered with invoice 90000363 (item 10, material 54) arrived damaged and leaking: 2 KG are lost. Please credit.\n\nRegards,\nQuality department, Cust DE 1',
  )
  if (!open) return null
  const submit = () => {
    const date = new Date().toUTCString()
    const eml = `From: ${from}\r\nTo: returns@o2c-hackathon.example\r\nSubject: ${subject}\r\nDate: ${date}\r\nMessage-ID: <manual-${Date.now()}@reclaim.local>\r\nContent-Type: text/plain; charset="utf-8"\r\nMIME-Version: 1.0\r\n\r\n${body}\r\n`
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
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={ingest.isPending || !subject.trim() || !body.trim()}>
            {ingest.isPending ? 'Adding…' : 'Add to inbox'}
          </Button>
        </div>
      </div>
    </div>
  )
}
