import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from './context'
import type { ApproveInput, RejectInput, ReleaseInput, SendReplyInput } from './client'
import type { Settings } from '@reclaim/shared'

export const useCases = () => {
  const api = useApi()
  return useQuery({ queryKey: ['cases'], queryFn: () => api.listCases() })
}

export const useCase = (id: string) => {
  const api = useApi()
  return useQuery({ queryKey: ['case', id], queryFn: () => api.getCase(id), enabled: id !== '' })
}

export const useStatus = () => {
  const api = useApi()
  return useQuery({ queryKey: ['status'], queryFn: () => api.getStatus(), refetchInterval: 5000 })
}

export const useSettings = () => {
  const api = useApi()
  return useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
}

export const useAnalytics = () => {
  const api = useApi()
  return useQuery({ queryKey: ['analytics'], queryFn: () => api.getAnalytics() })
}

export const useEval = () => {
  const api = useApi()
  return useQuery({ queryKey: ['eval'], queryFn: () => api.getLatestEval() })
}

function useInvalidate() {
  const qc = useQueryClient()
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
}

export const useUpdateSettings = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (p: Partial<Settings>) => api.updateSettings(p),
    onSuccess: () => inv('settings', 'status'),
  })
}

export const useSeed = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({ mutationFn: () => api.seedCases(), onSuccess: () => inv('cases', 'status') })
}

export const useIngest = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (files: File[]) => api.ingest(files), onSuccess: () => inv('cases', 'status') })
}

export const useRunCase = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.runCase(id), onSettled: () => inv('cases', 'status', 'analytics') })
}

export const useRunAll = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({ mutationFn: () => api.runAll(), onSettled: () => inv('cases', 'status', 'analytics') })
}

export const useChoose = () => {
  const api = useApi()
  return useMutation({ mutationFn: (proposalId: string) => api.chooseProposal(proposalId) })
}

export const useApprove = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (v: { proposalId: string; input: ApproveInput }) => api.approve(v.proposalId, v.input),
    onSettled: () => inv('cases', 'status', 'analytics'),
  })
}

export const useReject = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (v: { proposalId: string; input: RejectInput }) => api.reject(v.proposalId, v.input),
    onSettled: () => inv('cases', 'status', 'analytics'),
  })
}

export const useRelease = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (v: { id: string; input: ReleaseInput }) => api.release(v.id, v.input), onSettled: () => inv('cases', 'analytics') })
}

export const useSendReply = () => {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { caseId: string; input: SendReplyInput }) => api.sendReply(v.caseId, v.input),
    onSettled: (_r, _e, v) => qc.invalidateQueries({ queryKey: ['case', v.caseId] }),
  })
}

/** Goods receipt of a return, asked again every 15 s while the panel is open: the warehouse posts it, not the user. */
export const useReturnStatus = (sapDocumentId: string | null) => {
  const api = useApi()
  return useQuery({
    queryKey: ['returnStatus', sapDocumentId],
    queryFn: () => api.getReturnStatus(sapDocumentId!),
    enabled: sapDocumentId != null,
    refetchInterval: 15000,
  })
}

export const useRunEval = () => {
  const api = useApi()
  const inv = useInvalidate()
  return useMutation({ mutationFn: () => api.runEval(), onSuccess: () => inv('eval', 'cases', 'status') })
}

export const useReset = () => {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => api.reset(), onSuccess: () => qc.invalidateQueries() })
}
