// Materiales descargables. Los ficheros ligeros (≤10 MB) viven en
// public/grafocaligrafia/descargables/ y los sirve nginx como estáticos.
// Los pesados (>10 MB) viven en MinIO (platform/storage, kind
// `public_download`) con UUIDs fijos sembrados por
// scripts/seed-grafocaligrafia-downloads.mjs; el endpoint público
// GET /api/storage/public/:id responde 302 → presigned GET.
import { DEFAULT_TENANT_ID } from '../../lib/api'

const storageUrl = (id) =>
  `/api/storage/public/${id}?appId=aulavera&tenantId=${DEFAULT_TENANT_ID}`

export const descargables = [
  {
    title: 'Conferencia introductoria — Iniciarse en la Grafología Racional',
    file: '/grafocaligrafia/descargables/conferencia-introductoria-iniciarse-en-la-grafologia-racional.pdf',
    type: 'PDF',
    size: '7,6 MB',
  },
  {
    title: 'Plantillas orientadas',
    file: '/grafocaligrafia/descargables/plantillas-orientadas.pdf',
    type: 'PDF',
    size: '92 KB',
  },
  {
    title: 'Primera sesión — 001',
    file: storageUrl('3a0f0000-0000-4000-8000-000000000002'),
    type: 'PDF',
    size: '21 MB',
  },
  {
    title: 'Zurdos — primera sesión',
    file: '/grafocaligrafia/descargables/zurdos-primera-sesion.pdf',
    type: 'PDF',
    size: '6,7 MB',
  },
  {
    title: '«Oompa Loompa» para dormir bebés',
    file: '/grafocaligrafia/descargables/oompa-loompa-para-dormir-bebes.zip',
    type: 'ZIP',
    size: '5,2 MB',
  },
  {
    title: 'Los dibujos en la arena de Vanuatu',
    file: storageUrl('3a0f0000-0000-4000-8000-000000000001'),
    type: 'ZIP',
    size: '77 MB',
  },
  {
    title: 'Nishi undo — Aikido Wageningen at Kenkon 2016',
    file: storageUrl('3a0f0000-0000-4000-8000-000000000003'),
    type: 'ZIP',
    size: '17 MB',
  },
  {
    title: 'Cimática — Resonance phenomena in 2D on a plane',
    file: '/grafocaligrafia/descargables/cimitica-resonance-phenomena-in-2d-on-a-plane-youtube.zip',
    type: 'ZIP',
    size: '8 MB',
  },
]
