import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react'
import { attachmentKind, modelReads, type Attachment } from '@reclaim/shared'
import { cn } from '@/lib/utils'

const KIND_LABEL = { image: 'Photo', pdf: 'PDF', file: 'File' } as const

/**
 * The files that came with a complaint. Photos open full size in place, PDFs in the browser's viewer,
 * anything else downloads. `compact` is the one-line strip at the top of a long conversation.
 */
export function Attachments({ list, compact = false }: { list: Attachment[]; compact?: boolean }) {
  const [viewing, setViewing] = useState<Attachment | null>(null)
  if (!list.length) return null
  return (
    <>
      {compact ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 text-muted">
            <Paperclip className="size-3.5" aria-hidden /> {list.length}{' '}
            {list.length === 1 ? 'attachment' : 'attachments'}:
          </span>
          {list.map((a) => (
            <OpenLink
              key={a.url}
              a={a}
              onView={setViewing}
              className="rounded-full border border-line px-2 py-0.5 hover:bg-surface-2"
            />
          ))}
        </div>
      ) : (
        <ul className="mt-3 space-y-2" aria-label="Attachments">
          {list.map((a) => (
            <AttachmentItem key={a.url} a={a} onView={setViewing} />
          ))}
        </ul>
      )}
      {viewing && <ImageViewer a={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}

function note(a: Attachment) {
  return modelReads(a)
    ? 'read by the model as evidence'
    : 'kept with the case, not read by the model'
}

/** The file name as a link that opens it: a photo in the viewer, the rest in a new tab. */
function OpenLink({
  a,
  onView,
  className,
}: {
  a: Attachment
  onView: (a: Attachment) => void
  className?: string
}) {
  const kind = attachmentKind(a)
  const Icon = kind === 'image' ? ImageIcon : FileText
  const body = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{a.name}</span>
    </>
  )
  const cls = cn('inline-flex max-w-full items-center gap-1 hover:text-fg', className)
  return kind === 'image' ? (
    <button type="button" className={cls} onClick={() => onView(a)} aria-label={`View ${a.name}`}>
      {body}
    </button>
  ) : (
    <a href={a.url} target="_blank" rel="noreferrer" className={cls} aria-label={`Open ${a.name}`}>
      {body}
    </a>
  )
}

function AttachmentItem({ a, onView }: { a: Attachment; onView: (a: Attachment) => void }) {
  const kind = attachmentKind(a)
  return (
    <li className="rounded-md border border-line bg-surface p-2">
      {kind === 'image' && (
        <button
          type="button"
          onClick={() => onView(a)}
          className="mb-2 block cursor-zoom-in"
          aria-label={`View ${a.name} full size`}
        >
          <img src={a.url} alt={a.name} className="max-h-56 rounded border border-line" />
        </button>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <div className="min-w-0 flex-1">
          <OpenLink a={a} onView={onView} className="font-medium text-fg underline" />
          <div className="text-muted">
            {KIND_LABEL[kind]} · {note(a)}
          </div>
        </div>
        <FileActions a={a} />
      </div>
    </li>
  )
}

function FileActions({ a }: { a: Attachment }) {
  const btn =
    'inline-flex items-center gap-1 rounded border border-line px-2 py-1 font-medium text-fg hover:bg-surface-2'
  return (
    <div className="flex gap-1.5">
      {attachmentKind(a) !== 'file' && (
        <a href={a.url} target="_blank" rel="noreferrer" className={btn}>
          <ExternalLink className="size-3.5" aria-hidden /> Open
        </a>
      )}
      <a href={a.url} download={a.name} target="_blank" rel="noreferrer" className={btn}>
        <Download className="size-3.5" aria-hidden /> Download
      </a>
    </div>
  )
}

function ImageViewer({ a, onClose }: { a: Attachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={a.name}
        className="flex max-h-full max-w-5xl flex-col gap-2 rounded-lg bg-surface p-3 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-fg">{a.name}</div>
            <div className="text-muted">{note(a)}</div>
          </div>
          <FileActions a={a} />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-fg"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <img src={a.url} alt={a.name} className="min-h-0 max-h-[80vh] rounded object-contain" />
      </div>
    </div>
  )
}
