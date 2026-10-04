export const CASE_STATUSES = [
  'received',
  'investigating',
  'proposed',
  'awaiting_approval',
  'approved',
  'written_to_sap',
  'closed',
  'needs_customer_input',
  'handed_over',
  'duplicate',
  'rejected',
  'sap_write_failed',
] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

export const COMPLAINT_TYPES = [
  'damaged',
  'ruined',
  'quality',
  'price',
  'short_delivery',
  'over_quantity',
  'replacement',
  'follow_up',
  'unknown',
] as const
export type ComplaintType = (typeof COMPLAINT_TYPES)[number]

export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'NONE'] as const
export type RuleId = (typeof RULE_IDS)[number]

export const DOCUMENT_TYPES = ['YRE', 'YCR', 'NONE'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const REASON_CODE_IDS = ['101', '102', '103', '104', '105'] as const
export type ReasonCode = (typeof REASON_CODE_IDS)[number]

export const APPROVER_ROLES = ['customer_service_lead', 'credit_manager', 'finance_director'] as const
export type ApproverRole = (typeof APPROVER_ROLES)[number]

export const ROLES = [...APPROVER_ROLES, 'returns_desk'] as const
export type Role = (typeof ROLES)[number]

export const L4_STEP_IDS = ['5.1.1', '5.1.2', '5.1.3', '5.2.1', '5.2.2'] as const
export type L4Step = (typeof L4_STEP_IDS)[number]

export const AI_MODES = ['assisted', 'rules_only'] as const
export type AiMode = (typeof AI_MODES)[number]

export const SAP_MODES = ['mock', 'real'] as const
export type SapMode = (typeof SAP_MODES)[number]

export const EVENT_KINDS = [
  'intake',
  'lookup',
  'rule',
  'model',
  'proposal',
  'approval',
  'sap_write',
  'sap_release',
  'status',
  'error',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const ROLE_LABELS: Record<Role, string> = {
  customer_service_lead: 'Customer service lead',
  credit_manager: 'Credit manager',
  finance_director: 'Finance director',
  returns_desk: 'Returns desk',
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  received: 'Received',
  investigating: 'Investigating',
  proposed: 'Proposed',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  written_to_sap: 'Written to SAP',
  closed: 'Closed',
  needs_customer_input: 'Needs customer input',
  handed_over: 'Handed over',
  duplicate: 'Duplicate',
  rejected: 'Rejected',
  sap_write_failed: 'SAP write failed',
}

export const COMPLAINT_LABELS: Record<ComplaintType, string> = {
  damaged: 'Damaged in transit',
  ruined: 'Goods ruined',
  quality: 'Poor quality',
  price: 'Price difference',
  short_delivery: 'Short delivery',
  over_quantity: 'Over quantity',
  replacement: 'Replacement request',
  follow_up: 'Follow-up',
  unknown: 'Unclassified',
}
