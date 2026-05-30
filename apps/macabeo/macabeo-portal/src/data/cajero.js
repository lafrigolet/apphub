export const CATEGORIES = ['Todo', 'Frescos', 'Lácteo', 'Legumbres', 'Despensa', 'Bebidas', 'Granel', 'Pan']

export const PRODUCTS = [
  { id: 1,  ini: 't', nm: 'Tomate kumato',       ph: '500g · Horta da Lúa',     pr: 3.40,  col: '#C76E4A', granel: false },
  { id: 2,  ini: 'l', nm: 'Lechuga roble',        ph: 'ud · Horta da Lúa',       pr: 1.80,  col: '#5B8F3A', granel: false },
  { id: 3,  ini: 'q', nm: 'Queso curado',         ph: '300g · Meixón',            pr: 14.20, col: '#A6B89A', granel: false },
  { id: 4,  ini: 'y', nm: 'Yogur natural',        ph: '125g · Meixón',            pr: 1.20,  col: null,      granel: false },
  { id: 5,  ini: 'h', nm: 'Huevos campero',       ph: 'docena · Pepa',            pr: 4.50,  col: '#D5A021', granel: false },
  { id: 6,  ini: 'p', nm: 'Pan caaveiro',         ph: '500g · Forno O Marqués',  pr: 4.20,  col: '#9E3B23', granel: false },
  { id: 7,  ini: 'l', nm: 'Lentejas pardinas',    ph: '500g · Salgueiro',         pr: 5.90,  col: '#7A6F5C', granel: false },
  { id: 8,  ini: 'a', nm: 'Aceite oliva',         ph: '500ml · O Souto',          pr: 11.40, col: '#5B8F3A', granel: false },
  { id: 9,  ini: 'a', nm: 'Albaricoque',          ph: '500g · Pomares',           pr: 5.80,  col: '#D5A021', granel: false },
  { id: 10, ini: 'g', nm: 'Garbanzo castellano',  ph: '€/kg · Salgueiro',         pr: 6.10,  col: '#D5A021', granel: true  },
  { id: 11, ini: 'a', nm: 'Almendra cruda',       ph: '€/kg · Coop. Vall',        pr: 18.40, col: '#7A6F5C', granel: true  },
  { id: 12, ini: 's', nm: 'Sidra natural',        ph: '75cl · Llagar A.',         pr: 4.80,  col: '#5B8F3A', granel: false },
]

export const INITIAL_LINES = [
  { id: 1,  ini: 't', nm: 'Tomate kumato',      ph: '500g · Horta da Lúa',           col: '#C76E4A', qty: 2,   prUnit: 3.40,  granel: false, granelLabel: null   },
  { id: 2,  ini: 'p', nm: 'Pan caaveiro',       ph: '500g · Forno O Marqués',        col: '#9E3B23', qty: 1,   prUnit: 4.20,  granel: false, granelLabel: null   },
  { id: 3,  ini: 'q', nm: 'Queso curado',       ph: '300g · Meixón',                 col: '#A6B89A', qty: 1,   prUnit: 14.20, granel: false, granelLabel: null   },
  { id: 4,  ini: 'g', nm: 'Garbanzo castellano',ph: 'granel · 580 g · Salgueiro',    col: '#D5A021', qty: 580, prUnit: 0.0061,granel: true,  granelLabel: '580g' },
  { id: 5,  ini: 'y', nm: 'Yogur natural',      ph: '125g · Meixón',                 col: null,      qty: 4,   prUnit: 1.20,  granel: false, granelLabel: null   },
]
