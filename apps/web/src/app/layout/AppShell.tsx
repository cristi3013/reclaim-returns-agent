import { Outlet } from '@tanstack/react-router'
import { NavRail } from './NavRail'
import { TopBar } from './TopBar'
import { BottomTabs } from './BottomTabs'

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1440px] min-w-0 flex-1 px-4 py-4 pb-24 md:px-8 md:py-6">
          <Outlet />
        </main>
      </div>
      <BottomTabs />
    </div>
  )
}
