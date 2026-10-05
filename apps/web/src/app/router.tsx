import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { InboxPage } from '@/features/inbox/InboxPage'
import { CasePage } from '@/features/case/CasePage'
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage'
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage'
import { EvaluationPage } from '@/features/evaluation/EvaluationPage'

const rootRoute = createRootRoute({ component: AppShell })
const dashboard = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage })
const inbox = createRoute({ getParentRoute: () => rootRoute, path: '/inbox', component: InboxPage })
const caseRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cases/$id', component: CasePage })
/** `?case=<id>` opens the approvals page on that case (links from the dashboard). */
const approvals = createRoute({
  getParentRoute: () => rootRoute,
  path: '/approvals',
  component: ApprovalsPage,
  validateSearch: (s: Record<string, unknown>): { case?: string } => (typeof s.case === 'string' ? { case: s.case } : {}),
})
const analytics = createRoute({ getParentRoute: () => rootRoute, path: '/analytics', component: AnalyticsPage })
const evaluation = createRoute({ getParentRoute: () => rootRoute, path: '/evaluation', component: EvaluationPage })

export const router = createRouter({
  routeTree: rootRoute.addChildren([dashboard, inbox, caseRoute, approvals, analytics, evaluation]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
