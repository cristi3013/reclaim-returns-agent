import { RULES, type RuleId } from '@reclaim/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function RuleBadge({ ruleId }: { ruleId: RuleId | null }) {
  if (!ruleId) return <span className="text-muted">–</span>
  const gap = ruleId === 'NONE'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={
            gap
              ? 'inline-flex cursor-help rounded border border-warn/40 bg-warn-soft px-1.5 py-0.5 font-mono text-xs text-warn'
              : 'inline-flex cursor-help rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs'
          }
        >
          {gap ? 'no rule' : ruleId}
        </span>
      </TooltipTrigger>
      <TooltipContent>{RULES[ruleId].policyText}</TooltipContent>
    </Tooltip>
  )
}
