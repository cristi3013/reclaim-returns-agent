import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from './layout/AppShell'
import { InboxPage } from '@/features/inbox/InboxPage'
import { CasePage } from '@/features/case/CasePage'
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage'
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage'
import { EvaluationPage } from '@/features/evaluation/EvaluationPage'

const rootRoute = createRootRoute({ component: AppShell })
const inbox = createRoute({ getParentRoute: () => rootRoute, path: '/', component: InboxPage })
const caseRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cases/$id', component: CasePage })
const approvals = createRoute({ getParentRoute: () => rootRoute, path: '/approvals', component: ApprovalsPage })
const analytics = createRoute({ getParentRoute: () => rootRoute, path: '/analytics', component: AnalyticsPage })
const evaluation = createRoute({ getParentRoute: () => rootRoute, path: '/evaluation', component: EvaluationPage })

export const router = createRouter({
  routeTree: rootRoute.addChildren([inbox, caseRoute, approvals, analytics, evaluation]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
