/** Every backend route the frontend uses. The backend implements these; the HTTP client is built from them. */
export const API_ROUTES = {
  listCases: { method: 'GET', path: '/api/cases' },
  getCase: { method: 'GET', path: '/api/cases/:id' },
  seedCases: { method: 'POST', path: '/api/cases/seed' },
  ingest: { method: 'POST', path: '/api/cases/ingest' },
  runCase: { method: 'POST', path: '/api/cases/:id/run' },
  runAll: { method: 'POST', path: '/api/cases/run-all' },
  sendReply: { method: 'POST', path: '/api/cases/:id/reply' },
  changeStatus: { method: 'POST', path: '/api/cases/:id/status' },
  chooseProposal: { method: 'POST', path: '/api/proposals/:id/choose' },
  approve: { method: 'POST', path: '/api/proposals/:id/approve' },
  reject: { method: 'POST', path: '/api/proposals/:id/reject' },
  release: { method: 'POST', path: '/api/sap/:id/release' },
  confirmGoodsReceipt: { method: 'POST', path: '/api/sap/:id/goods-receipt' },
  returnStatus: { method: 'GET', path: '/api/sap/:id/status' },
  analytics: { method: 'GET', path: '/api/analytics/summary' },
  runEval: { method: 'POST', path: '/api/eval/run' },
  latestEval: { method: 'GET', path: '/api/eval/latest' },
  status: { method: 'GET', path: '/api/status' },
  getSettings: { method: 'GET', path: '/api/settings' },
  updateSettings: { method: 'PUT', path: '/api/settings' },
  events: { method: 'GET', path: '/api/events' },
  reset: { method: 'POST', path: '/api/demo/reset' },
} as const

export type RouteKey = keyof typeof API_ROUTES
