export const PERSONAS = {
  staff: { id: 'u-staff-01', name: 'Ana García',     email: 'ana@voragine.app',   role_label: 'Staff · SUPER_ADMIN', avatarColor: '#D9512C' },
  owner: { id: 'u-own-07',   name: 'Pedro Martínez', email: 'pedro@tiendaana.com', role_label: 'Owner · Tienda Ana',  avatarColor: '#2F6F4F' },
  admin: { id: 'u-adm-11',   name: 'Laura Ruiz',     email: 'laura@tiendaana.com', role_label: 'Admin · Tienda Ana',  avatarColor: '#2C5280' },
}

export const TENANTS = [
  { id:'t-001', name:'Tienda Ana',         legal:'Tienda Ana SL',          cif:'B12345678', country:'ES', plan:'PRO',        status:'ACTIVE',    subdomain:'tienda-ana',       customDomain:'tienda-ana.com',   stripe:'VERIFIED',     created:'2024-03-12', owner:'u-own-07', subTenants:false, volMonth:147820, txMonth:3421,  balance:0 },
  { id:'t-002', name:'Pedro Market',       legal:'Pedro Digital SL',       cif:'B87654321', country:'ES', plan:'STARTER',    status:'ACTIVE',    subdomain:'pedro',             customDomain:null,               stripe:'VERIFIED',     created:'2024-05-20', owner:'u-own-20', subTenants:true,  volMonth:58210,  txMonth:1120,  balance:0 },
  { id:'t-003', name:'Marketplace Norte',  legal:'MN Digital SL',          cif:'B22334455', country:'ES', plan:'PRO',        status:'SUSPENDED', subdomain:'marketplace-norte', customDomain:null,               stripe:'RESTRICTED',   created:'2023-11-04', owner:'u-own-03', subTenants:true,  volMonth:0,      txMonth:0,     balance:340, suspendReason:'NON_PAYMENT' },
  { id:'t-004', name:'Artisan Co.',        legal:'Artisan Coop LTD',       cif:'GB7722100', country:'GB', plan:'ENTERPRISE', status:'ACTIVE',    subdomain:'artisan',           customDomain:'shop.artisan.co',  stripe:'VERIFIED',     created:'2023-07-18', owner:'u-own-04', subTenants:false, volMonth:412400, txMonth:8900,  balance:0 },
  { id:'t-005', name:'FoodHub',            legal:'FoodHub Tech SAS',       cif:'FR9911222', country:'FR', plan:'PRO',        status:'ACTIVE',    subdomain:'foodhub',           customDomain:null,               stripe:'PENDING',      created:'2025-01-14', owner:'u-own-05', subTenants:true,  volMonth:98320,  txMonth:2340,  balance:0 },
  { id:'t-006', name:'Ciclo Bike',         legal:'Ciclo Iberia SL',        cif:'B55667788', country:'ES', plan:'STARTER',    status:'ACTIVE',    subdomain:'ciclo-bike',        customDomain:null,               stripe:'VERIFIED',     created:'2024-09-02', owner:'u-own-06', subTenants:false, volMonth:23140,  txMonth:412,   balance:0 },
  { id:'t-007', name:'AulaLab',            legal:'AulaLab Educación SL',   cif:'B99887766', country:'ES', plan:'PRO',        status:'ARCHIVED',  subdomain:'aulalab',           customDomain:null,               stripe:'DISCONNECTED', created:'2023-02-28', owner:null,       subTenants:false, volMonth:0,      txMonth:0,     balance:0, archivedAt:'2025-11-20' },
  { id:'t-008', name:'Rentas Mar',         legal:'Rentas del Mar SL',      cif:'B44556677', country:'ES', plan:'PRO',        status:'ACTIVE',    subdomain:'rentas-mar',        customDomain:'rentasmar.es',     stripe:'VERIFIED',     created:'2024-02-11', owner:'u-own-08', subTenants:false, volMonth:201500, txMonth:980,   balance:0 },
  { id:'t-009', name:'Gimnasio Horizonte', legal:'Horizonte Fit SL',       cif:'B11223344', country:'ES', plan:'STARTER',    status:'ACTIVE',    subdomain:'horizonte',         customDomain:null,               stripe:'VERIFIED',     created:'2025-02-05', owner:'u-own-09', subTenants:false, volMonth:14800,  txMonth:320,   balance:0 },
  { id:'t-010', name:'CasaVerde',          legal:'CasaVerde Eco SL',       cif:'B66778899', country:'ES', plan:'PRO',        status:'SUSPENDED', subdomain:'casaverde',         customDomain:null,               stripe:'VERIFIED',     created:'2024-06-30', owner:'u-own-10', subTenants:false, volMonth:0,      txMonth:0,     balance:0, suspendReason:'SECURITY_INCIDENT' },
  { id:'t-011', name:'Libros del Sur',     legal:'Libros del Sur SL',      cif:'B00998877', country:'ES', plan:'STARTER',    status:'ACTIVE',    subdomain:'librosdelsur',      customDomain:null,               stripe:'VERIFIED',     created:'2025-03-11', owner:'u-own-11', subTenants:false, volMonth:8900,   txMonth:210,   balance:0 },
  { id:'t-012', name:'StudioPro',          legal:'Studio Pro Digital SL',  cif:'B33445566', country:'ES', plan:'ENTERPRISE', status:'ACTIVE',    subdomain:'studio-pro',        customDomain:'studiopro.io',     stripe:'VERIFIED',     created:'2023-09-12', owner:'u-own-12', subTenants:true,  volMonth:680120, txMonth:15200, balance:0 },
]

export const ADMINS_BY_TENANT = {
  't-001': [
    { id:'u-own-07', name:'Pedro Martínez', email:'pedro@tiendaana.com',  role:'OWNER', twofa:true,  last:'2026-04-21T08:32:00Z', avatar:'#2F6F4F' },
    { id:'u-adm-11', name:'Laura Ruiz',     email:'laura@tiendaana.com',  role:'ADMIN', twofa:true,  last:'2026-04-20T17:11:00Z', avatar:'#2C5280' },
    { id:'u-adm-12', name:'Marcos Vila',    email:'marcos@tiendaana.com', role:'ADMIN', twofa:false, last:'2026-04-18T12:05:00Z', avatar:'#8A6B0A' },
  ],
  't-002': [
    { id:'u-own-20', name:'Sara López',  email:'sara@pedromarket.com',  role:'OWNER', twofa:true, last:'2026-04-21T10:01:00Z', avatar:'#A83E1F' },
    { id:'u-adm-21', name:'Nacho Bravo', email:'nacho@pedromarket.com', role:'ADMIN', twofa:true, last:'2026-04-19T09:20:00Z', avatar:'#2C5280' },
  ],
}

export const INVITES_BY_TENANT = {
  't-001': [
    { id:'inv-01', email:'juan.silva@tiendaana.com', role:'ADMIN', sent:'2026-04-18T11:00:00Z', expires:'2026-04-25T11:00:00Z', status:'PENDING' },
  ],
  't-002': [],
}

export const STAFF = [
  { id:'u-staff-01', name:'Ana García',   email:'ana@voragine.app',    role:'SUPER_ADMIN', twofa:true,  last:'2026-04-21T09:00:00Z', avatar:'#D9512C' },
  { id:'u-staff-02', name:'David Pérez',  email:'david@voragine.app',  role:'STAFF',       twofa:true,  last:'2026-04-20T18:30:00Z', avatar:'#2F6F4F' },
  { id:'u-staff-03', name:'Elena Soto',   email:'elena@voragine.app',  role:'STAFF',       twofa:false, last:'2026-04-19T10:15:00Z', avatar:'#2C5280' },
  { id:'u-staff-04', name:'Miguel Duque', email:'miguel@voragine.app', role:'SUPER_ADMIN', twofa:true,  last:'2026-04-21T07:45:00Z', avatar:'#8A6B0A' },
]

export const AUDIT = [
  { ts:'2026-04-21T09:12:00Z', actor:'Ana García',     actorRole:'Staff', tenant:'t-003', tenantName:'Marketplace Norte', action:'TENANT_SUSPENDED',     detail:'Motivo: NON_PAYMENT',                    ip:'81.202.11.44' },
  { ts:'2026-04-21T08:40:00Z', actor:'Pedro Martínez', actorRole:'Owner', tenant:'t-001', tenantName:'Tienda Ana',        action:'INVITE_SENT',           detail:'marcos@tiendaana.com (ADMIN)',           ip:'91.126.22.1'  },
  { ts:'2026-04-20T17:55:00Z', actor:'Laura Ruiz',     actorRole:'Admin', tenant:'t-001', tenantName:'Tienda Ana',        action:'TENANT_UPDATED',        detail:'teléfono actualizado',                   ip:'91.126.22.1'  },
  { ts:'2026-04-20T14:22:00Z', actor:'Ana García',     actorRole:'Staff', tenant:'t-005', tenantName:'FoodHub',           action:'TENANT_CREATED',        detail:'plan PRO, owner: cc@foodhub.fr',         ip:'81.202.11.44' },
  { ts:'2026-04-20T11:07:00Z', actor:'Pedro Martínez', actorRole:'Owner', tenant:'t-001', tenantName:'Tienda Ana',        action:'ROLE_CHANGED',          detail:'Laura Ruiz: ADMIN → ADMIN (sin cambio)', ip:'91.126.22.1'  },
  { ts:'2026-04-19T16:30:00Z', actor:'David Pérez',    actorRole:'Staff', tenant:'t-010', tenantName:'CasaVerde',         action:'TENANT_SUSPENDED',      detail:'Motivo: SECURITY_INCIDENT',              ip:'81.202.11.55' },
  { ts:'2026-04-19T10:15:00Z', actor:'Sara López',     actorRole:'Owner', tenant:'t-002', tenantName:'Pedro Market',      action:'INVITE_SENT',           detail:'nacho@pedromarket.com (ADMIN)',          ip:'77.230.5.10'  },
  { ts:'2026-04-18T13:00:00Z', actor:'Ana García',     actorRole:'Staff', tenant:'t-007', tenantName:'AulaLab',           action:'TENANT_ARCHIVED',       detail:'Retención: 90 días',                     ip:'81.202.11.44' },
  { ts:'2026-04-18T11:00:00Z', actor:'Pedro Martínez', actorRole:'Owner', tenant:'t-001', tenantName:'Tienda Ana',        action:'INVITE_SENT',           detail:'juan.silva@tiendaana.com (ADMIN)',       ip:'91.126.22.1'  },
  { ts:'2026-04-17T09:45:00Z', actor:'Laura Ruiz',     actorRole:'Admin', tenant:'t-001', tenantName:'Tienda Ana',        action:'ADMIN_REVOKED',         detail:'sergio@tiendaana.com',                   ip:'91.126.22.1'  },
]
