// Módulo "bootstrap" — meta-módulo que renderiza el panel "Configura tu
// cuenta" cuando el tenant aún no ha terminado la Fase B del onboarding.
//
// A diferencia del resto de módulos, no tiene sidebar ni cards en el
// dashboard "normal": el shell lo presenta como contenido principal
// mientras `tenant.bootstrap_completed_at IS NULL`. El owner puede
// minimizarlo, pero vuelve al refrescar mientras queden REQUIRED en
// pending.
import BootstrapPanel from './views/BootstrapPanel'

const VIEW_PANEL = 'bootstrap-panel'

export default {
  id:         'bootstrap',
  capability: 'bootstrap',
  label:      'Configura tu cuenta',

  // No `dashboardCards` ni `sidebar`: el shell lo decide via context
  // (DashboardGrid renderiza BootstrapPanel cuando hay status pendiente).
  routes: {
    [VIEW_PANEL]: () => <BootstrapPanel />,
  },
}
