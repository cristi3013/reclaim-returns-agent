export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-bad/40 bg-bad-soft p-4 text-bad">
      <div className="font-medium">Something went wrong</div>
      <div className="text-sm">{error instanceof Error ? error.message : String(error)}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 text-sm underline">
          Try again
        </button>
      )}
    </div>
  )
}
