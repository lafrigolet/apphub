// Stable, ordered list of categories the sidebar renders. Each manifest
// entry attaches itself to one of these via `category` so the visual
// geography of the console is consistent regardless of which modules a
// tenant has enabled. Categories with zero entries are not rendered.
//
// Add new categories sparingly — the goal is a predictable mental map for
// users who switch between tenants with different module sets.
export const CATEGORIES = [
  { id: 'home',          label: null }, // Inicio is rendered as a single top-level link, not a section
  { id: 'business',      label: 'Negocio' },
  { id: 'operations',    label: 'Operaciones' },
  { id: 'commercial',    label: 'Comercial' },
  { id: 'conversations', label: 'Conversaciones' },
  { id: 'configuration', label: 'Configuración' },
]

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id
}
