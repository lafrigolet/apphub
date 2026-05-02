// Top-level entry — delegates to the shell. The shell decides whether to
// render the login screen or the authenticated layout (Topbar / Sidebar /
// MainContent / Toasts).
import ShellApp from './shell/App'

export default function App() {
  return <ShellApp />
}
