// Dev-only quick-switch credentials — seeded by scripts/seed.js.
// Guarded by import.meta.env.DEV in callers so production builds omit them.

export const DEV_PERSONAS = [
  {
    key:    'staff',
    label:  'Staff · SUPER_ADMIN',
    name:   'Ana García',
    email:  'ana@voragine.local',
    password: 'password123',
    asStaff: true,
    color:  '#D9512C',
  },
  {
    key:    'owner',
    label:  'Owner · Tienda Ana',
    name:   'Pedro Martínez',
    email:  'pedro@tiendaana.com',
    password: 'password123',
    asStaff: false,
    tenantId: '10000000-0000-0000-0000-000000000001',
    color:  '#2F6F4F',
  },
  {
    key:    'admin',
    label:  'Admin · Tienda Ana',
    name:   'Laura Ruiz',
    email:  'laura@tiendaana.com',
    password: 'password123',
    asStaff: false,
    tenantId: '10000000-0000-0000-0000-000000000001',
    color:  '#2C5280',
  },
]
