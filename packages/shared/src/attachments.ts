/** Attachment types the model can read: photos, and PDFs such as a signed delivery note. Others are kept, not read. */
export const MODEL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const MODEL_READABLE_TYPES: readonly string[] = [...MODEL_IMAGE_TYPES, 'application/pdf']
/** Larger files are skipped rather than sent: the model's request limit is about 32 MB. */
export const MODEL_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
}

/** The media type from a file name or URL, or null when the extension is unknown. */
export function mimeFromName(name: string): string | null {
  return EXTENSION_TYPES[name.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

/** How a case attachment is shown to the desk: photos inline, PDFs in the browser viewer, the rest as downloads. */
export function attachmentKind(a: { name: string; mimeType: string }): 'image' | 'pdf' | 'file' {
  const type = MODEL_READABLE_TYPES.includes(a.mimeType)
    ? a.mimeType
    : (mimeFromName(a.name) ?? a.mimeType)
  if (type === 'application/pdf') return 'pdf'
  return type.startsWith('image/') ? 'image' : 'file'
}

/** True when the model reads this attachment as evidence (by type; very large files are still skipped). */
export function modelReads(a: { name: string; mimeType: string }): boolean {
  return (
    MODEL_READABLE_TYPES.includes(a.mimeType) ||
    MODEL_READABLE_TYPES.includes(mimeFromName(a.name) ?? '')
  )
}
