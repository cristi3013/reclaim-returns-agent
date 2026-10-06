import type { Proposal } from '@reclaim/shared'

/** The option a person starts from: the one already chosen, else the one the rules recommend. */
export function defaultOption(proposals: Proposal[]): string | undefined {
  return (proposals.find((p) => p.chosen) ?? proposals.find((p) => p.recommended) ?? proposals[0])
    ?.id
}
