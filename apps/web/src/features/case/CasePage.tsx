import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Check, ChevronRight, FileText, Play, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useApi, useCase, useCases, useChoose, useRunCase, useStatus } from '@/api'
import {
  COMPLAINT_LABELS,
  ROLE_LABELS,
  caseStatusByComplaint,
  conversation,
  groupByInvoice,
  invoiceConversation,
  primaryProposal,
  type Case,
} from '@reclaim/shared'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CHIP } from '@/features/invoice-cases/status'
import { useUi } from '@/store/ui'
import { StatusMenu } from '@/components/domain/StatusMenu'
import { exportCaseAuditPack } from '@/features/reports/export'
import { AgentReadPanel, ComplaintPanel } from './ComplaintPanel'
import { SapFindingsPanel } from './SapFindingsPanel'
import { ProposalCard } from './ProposalCard'
import { Conversation } from '@/components/domain/Conversation'
import { Attachments } from '@/components/domain/Attachments'
import { ReplyPanel } from './ReplyPanel'
import { ApprovalActions } from '@/features/approvals/ApprovalPanel'
import { OptionPicker, defaultOption } from '@/features/approvals/OptionPicker'
import { StatusChip } from '@/components/domain/StatusChip'
import { ErrorState } from '@/components/domain/ErrorState'
import { AuditTimeline } from '@/features/audit/AuditTimeline'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** Statuses where a person decides, or has decided, on the proposal. The rest only need the reply. */
const DECISION_STATUSES = ['awaiting_approval', 'written_to_sap', 'sap_write_failed', 'closed']

export function CasePage() {
  const { id } = useParams({ from: '/cases/$id' })
  const q = useCase(id)
  const list = useCases()
  const run = useRunCase()
  const choose = useChoose()
  const status = useStatus()
  const { role } = useUi()
  const [pick, setPick] = useState<string>()
  const api = useApi()
  const c = q.data
  // One case per invoice: the other complaints on it, for the switcher and the whole conversation.
  const ic = c?.invoiceNumber
    ? groupByInvoice(list.data ?? []).find((x) => x.invoice === c.invoiceNumber)
    : undefined
  const siblings = useQueries({
    queries: (ic && ic.complaints.length > 1 ? ic.complaints : []).map((s) => ({
      queryKey: ['case', s.id],
      queryFn: () => api.getCase(s.id),
    })),
  })
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error || !c)
    return <ErrorState error={q.error ?? 'Case not found'} onRetry={() => q.refetch()} />
  const two = c.proposals.length > 1
  const running = c.status === 'investigating' || c.status === 'proposed' || run.isPending
  const locked = c.sapDocuments.length > 0
  const waiting = c.status === 'awaiting_approval'
  // Two options: while it waits, the person picks one, then sends it to approval or decides it here.
  const primary = waiting
    ? (c.proposals.find((p) => p.id === (pick ?? defaultOption(c.proposals))) ?? primaryProposal(c))
    : primaryProposal(c)
  // No invoice number, nothing to decide: the case is only its emails until the customer names one.
  const noInvoice = !c.invoiceNumber
  // Decide here as well as in the approvals queue: approve or reject, then the SAP result and the reply.
  const decidable = !noInvoice && !!primary && DECISION_STATUSES.includes(c.status)
  const sent = !!primary?.chosen
  const loaded = siblings.map((x) => x.data).filter((x): x is Case => !!x)
  const invoiceMessages = loaded.length > 1 ? invoiceConversation(loaded) : undefined
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted">
            <Link to="/invoices" className="hover:text-fg hover:underline">
              Cases
            </Link>
            <ChevronRight className="size-3" aria-hidden />
            {c.invoiceNumber && (
              <>
                <Link
                  to="/invoices/$invoice"
                  params={{ invoice: c.invoiceNumber }}
                  className="font-mono hover:text-fg hover:underline"
                >
                  {c.invoiceNumber}
                </Link>
                <ChevronRight className="size-3" aria-hidden />
              </>
            )}
            <span className="font-mono">{c.id}</span>
          </nav>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{c.subject}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {/* The status of the case: the same for every complaint and email on this invoice. */}
            <StatusChip
              status={CHIP[caseStatusByComplaint(list.data ?? []).get(c.id) ?? 'pending']}
            />
            {c.invoiceNumber && (
              <Link
                to="/invoices/$invoice"
                params={{ invoice: c.invoiceNumber }}
                className="font-mono hover:text-fg hover:underline"
                title="Open the case for this invoice: every complaint and email about it"
              >
                invoice {c.invoiceNumber}
              </Link>
            )}
            <span>{c.customerName}</span>
            <span className="rounded bg-surface-2 px-1.5 text-xs">
              {c.aiMode === 'rules_only' ? 'rules only' : 'AI assisted'}
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={() =>
              exportCaseAuditPack(c, {
                generatedBy: ROLE_LABELS[role],
                sapMode: status.data?.sapSystem ?? 'DS4',
              }).then(
                () => toast.success('Audit pack downloaded'),
                (e) =>
                  toast.error(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed'),
              )
            }
            title="Download this case's proposal, approvals, SAP documents and audit log as a PDF"
          >
            <FileText className="size-4" /> Audit PDF
          </Button>
          <StatusMenu c={c} role={role} actor={ROLE_LABELS[role]} size="default" />
          {c.status === 'awaiting_approval' && (
            <Button asChild variant="ghost">
              <Link to="/approvals" search={{ case: c.id }}>
                Open in To approve
              </Link>
            </Button>
          )}
          <Button
            onClick={() =>
              run.mutate(id, {
                onError: (e) => toast.error(e instanceof Error ? e.message : 'Run failed'),
              })
            }
            disabled={running || locked}
            title={
              locked ? 'This case already has a SAP document; it cannot be re-run.' : undefined
            }
          >
            <Play className="size-4" />{' '}
            {running ? 'Investigating…' : c.proposals.length ? 'Investigate again' : 'Investigate'}
          </Button>
        </div>
      </div>

      {ic && ic.complaints.length > 1 && (
        <nav
          aria-label="Complaints on this invoice"
          className="-mt-3 mb-4 flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="font-semibold text-muted">Complaints on this invoice</span>
          {ic.complaints.map((s, i) => (
            <Link
              key={s.id}
              to="/cases/$id"
              params={{ id: s.id }}
              aria-current={s.id === c.id ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 hover:bg-surface-2',
                s.id === c.id
                  ? 'border-fg bg-surface-2 font-medium text-fg'
                  : 'border-line text-muted',
              )}
            >
              <span>
                {i + 1} · {COMPLAINT_LABELS[s.complaintType]}
              </span>
              {s.ruleId && <DocTypeBadge type={s.documentType} compact />}
              <span>{formatDateTime(s.receivedAt)}</span>
            </Link>
          ))}
        </nav>
      )}

      {decidable && primary && (
        <section
          aria-labelledby="decision-title"
          className={`mb-4 rounded-lg border bg-surface p-4 shadow-card ${
            waiting ? 'border-accent border-l-4' : 'border-line'
          }`}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="decision-title" className="font-semibold">
              {waiting ? 'Your decision' : 'Decision'}
            </h2>
            {waiting && primary.decision.approverRole && (
              <span className="text-xs text-muted">
                needs a {ROLE_LABELS[primary.decision.approverRole]} or above
              </span>
            )}
          </div>
          {waiting && two && (
            <>
              <p className="mt-1 text-sm text-muted">
                The agent found two options. Pick one, then send it to approval or decide it now.
              </p>
              <OptionPicker
                proposals={c.proposals}
                value={primary.id}
                onChange={setPick}
                disabled={choose.isPending}
              />
            </>
          )}
          {waiting && <p className="mt-3 text-sm">{primary.briefing.whatWePropose}</p>}
          {waiting && two && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={sent || choose.isPending}
                onClick={() =>
                  choose.mutate(primary.id, {
                    onSuccess: () => toast.success(`Option ${primary.option} sent to approval`),
                    onError: (e) => toast.error(e instanceof Error ? e.message : 'Not sent'),
                  })
                }
              >
                {sent ? <Check className="size-4" /> : <Send className="size-4" />}
                {sent ? `Option ${primary.option} sent to approval` : 'Send to approval'}
              </Button>
              <span className="text-xs text-muted">
                {sent
                  ? 'It waits in To approve. Pick the other option to change it.'
                  : 'or approve or reject it yourself below.'}
              </span>
            </div>
          )}
          <ApprovalActions
            key={primary.id}
            c={c}
            p={primary}
            role={role}
            actor={ROLE_LABELS[role]}
          />
        </section>
      )}

      {noInvoice ? (
        <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
          <h2 className="text-base font-semibold text-fg">
            Conversation · {conversation(c).length} email{conversation(c).length === 1 ? '' : 's'}
          </h2>
          <p className="mt-1 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
            No invoice number yet: there is nothing to approve or reject. Ask the customer for it;
            when they answer, investigate again.
          </p>
          <Attachments list={c.attachments} compact />
          <Conversation
            messages={conversation(c)}
            customerFrom={c.from}
            label="Emails in this case"
          />
          <ReplyPanel c={c} role={role} actor={ROLE_LABELS[role]} />
        </section>
      ) : (
        // The proposal and the conversation get the room; SAP and what the agent read sit beside them.
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {/* The options in full, policy text and all, right under the decision. */}
            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">
                {two ? 'Proposal · two options, a person chooses' : 'Proposal'}
              </h2>
              {c.proposals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line p-8 text-center text-muted">
                  {running
                    ? 'The agent is reading the complaint and looking up SAP…'
                    : 'No proposal yet. Run the agent.'}
                </div>
              ) : (
                <div className={two ? 'grid grid-cols-1 gap-4 md:grid-cols-2' : ''}>
                  {c.proposals.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      selected={two && waiting && p.id === primary?.id}
                    />
                  ))}
                </div>
              )}
            </section>
            <div className="mt-4">
              <ComplaintPanel c={c} invoiceMessages={invoiceMessages} />
            </div>
            {!decidable && <ReplyPanel c={c} role={role} actor={ROLE_LABELS[role]} />}
          </div>
          <aside aria-label="Case facts" className="space-y-4 lg:sticky lg:top-4">
            <AgentReadPanel c={c} />
            <SapFindingsPanel c={c} />
          </aside>
        </div>
      )}

      <Tabs defaultValue="timeline" className="mt-6">
        <TabsList>
          <TabsTrigger value="timeline">Timeline &amp; audit</TabsTrigger>
          <TabsTrigger value="raw">Raw data</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline">
          <AuditTimeline c={c} />
        </TabsContent>
        <TabsContent value="raw">
          <pre className="max-h-[32rem] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs">
            {JSON.stringify(c, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  )
}
