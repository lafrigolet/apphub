import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import SandboxBanner from './SandboxBanner'

export default function AppShell() {
  return (
    <div className="min-h-screen flex flex-col">
      <SandboxBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8 max-w-[1100px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
