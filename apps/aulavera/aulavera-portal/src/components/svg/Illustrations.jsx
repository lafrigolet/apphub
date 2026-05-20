// Illustrations imported from aulavera.html — kept as React components to avoid dangerouslySetInnerHTML.

export function Campsite() {
  return (
    <svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="sky" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#F5E6CE" />
          <stop offset="60%" stopColor="#E5BC72" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#F4EDDE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B89A6E" />
          <stop offset="100%" stopColor="#8E7440" />
        </linearGradient>
      </defs>
      <circle cx="300" cy="240" r="290" fill="url(#sky)" />
      <circle cx="300" cy="220" r="58" fill="#E5BC72" opacity="0.85" />
      <path d="M 0 380 L 90 290 L 170 350 L 260 250 L 340 330 L 430 240 L 520 320 L 600 270 L 600 600 L 0 600 Z" fill="#6B8E4E" opacity="0.55" />
      <path d="M 0 430 L 80 360 L 180 410 L 270 350 L 360 410 L 450 360 L 540 410 L 600 380 L 600 600 L 0 600 Z" fill="#2C4A2A" opacity="0.85" />
      <path d="M 0 470 Q 300 450 600 470 L 600 600 L 0 600 Z" fill="url(#ground)" />
      <g transform="translate(70,330)">
        <rect x="-3" y="60" width="6" height="32" fill="#5A4836" />
        <polygon points="0,0 -28,60 28,60" fill="#2C4A2A" />
        <polygon points="0,15 -22,55 22,55" fill="#1E3520" />
      </g>
      <g transform="translate(120,360)">
        <rect x="-2" y="50" width="4" height="22" fill="#5A4836" />
        <polygon points="0,0 -20,50 20,50" fill="#2C4A2A" />
      </g>
      <g transform="translate(500,330)">
        <rect x="-3" y="60" width="6" height="34" fill="#5A4836" />
        <polygon points="0,0 -30,60 30,60" fill="#2C4A2A" />
        <polygon points="0,15 -24,55 24,55" fill="#1E3520" />
      </g>
      <g transform="translate(540,360)">
        <rect x="-2" y="50" width="4" height="22" fill="#5A4836" />
        <polygon points="0,0 -20,50 20,50" fill="#2C4A2A" />
      </g>
      <g transform="translate(220,400)">
        <polygon points="0,0 -50,80 50,80" fill="#7CADC5" />
        <polygon points="0,0 -10,80 0,80" fill="#5A8DA5" />
        <polygon points="0,12 -32,72 0,72" fill="#1E3520" opacity="0.6" />
        <line x1="0" y1="0" x2="0" y2="80" stroke="#3A2E1F" strokeWidth="2" />
      </g>
      <g transform="translate(360,470)">
        <ellipse cx="0" cy="14" rx="22" ry="5" fill="#3A2E1F" opacity="0.5" />
        <path d="M -16 12 L 14 -2" stroke="#5A4836" strokeWidth="3" strokeLinecap="round" />
        <path d="M -14 -2 L 16 12" stroke="#5A4836" strokeWidth="3" strokeLinecap="round" />
        <path d="M 0 -2 Q -8 -22 0 -36 Q 6 -22 0 -2 Z" fill="#B5532A" />
        <path d="M 0 -6 Q -4 -20 2 -30 Q 4 -18 0 -6 Z" fill="#E5BC72" />
      </g>
      <g transform="translate(310,440) rotate(15)">
        <ellipse cx="0" cy="0" rx="20" ry="26" fill="#B5532A" />
        <ellipse cx="0" cy="0" rx="14" ry="20" fill="#8E3D1B" />
        <circle cx="0" cy="0" r="5" fill="#2B2218" />
        <rect x="-2" y="-50" width="4" height="30" fill="#5A4836" />
        <rect x="-4" y="-54" width="8" height="6" rx="1" fill="#3A2E1F" />
      </g>
      <g transform="translate(420,455)">
        <rect x="-18" y="-30" width="36" height="40" rx="6" fill="#C8923D" />
        <rect x="-14" y="-22" width="28" height="14" rx="2" fill="#8E7440" />
        <circle cx="0" cy="-2" r="6" fill="#2B2218" />
        <circle cx="0" cy="-2" r="3" fill="#E5BC72" />
        <line x1="0" y1="-5" x2="0" y2="2" stroke="#2B2218" strokeWidth="1.2" />
        <line x1="-3" y1="-2" x2="3" y2="-2" stroke="#2B2218" strokeWidth="1.2" />
      </g>
      <g fill="#C8923D" opacity="0.9">
        <g transform="translate(140,140)">
          <ellipse cx="0" cy="14" rx="6" ry="5" transform="rotate(-15)" />
          <rect x="4" y="-12" width="2.5" height="22" transform="rotate(-15)" />
        </g>
        <g transform="translate(180,90)">
          <ellipse cx="0" cy="14" rx="5" ry="4" transform="rotate(-15)" />
          <rect x="3" y="-8" width="2" height="18" transform="rotate(-15)" />
        </g>
        <g transform="translate(460,110)">
          <ellipse cx="0" cy="14" rx="6" ry="5" transform="rotate(15)" />
          <rect x="-7" y="-10" width="2.5" height="20" transform="rotate(15)" />
          <ellipse cx="20" cy="10" rx="6" ry="5" transform="rotate(15)" />
          <rect x="13" y="-14" width="2.5" height="20" transform="rotate(15)" />
          <path d="M 7 -14 Q 18 -18 27 -10" stroke="#C8923D" strokeWidth="2" fill="none" />
        </g>
      </g>
      <g fill="none" stroke="#3A2E1F" strokeWidth="1.5" strokeLinecap="round">
        <path d="M 100 200 Q 110 192 120 200 Q 130 192 140 200" />
        <path d="M 380 150 Q 388 144 396 150 Q 404 144 412 150" />
      </g>
    </svg>
  )
}

export function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7 17 L17 7 M9 7 L17 7 L17 15" />
    </svg>
  )
}

export function Olives() {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill="#E5D5A8" />
      <rect y="270" width="400" height="130" fill="#9C8855" />
      <g fill="#6B8E4E">
        <ellipse cx="80" cy="220" rx="50" ry="46" />
        <ellipse cx="180" cy="210" rx="58" ry="54" />
        <ellipse cx="290" cy="225" rx="55" ry="48" />
      </g>
      <g fill="#2C4A2A" opacity="0.5">
        <ellipse cx="80" cy="240" rx="40" ry="30" />
        <ellipse cx="180" cy="230" rx="48" ry="36" />
        <ellipse cx="290" cy="245" rx="44" ry="32" />
      </g>
      <g fill="#5A4836">
        <rect x="76" y="250" width="8" height="40" />
        <rect x="176" y="248" width="8" height="42" />
        <rect x="286" y="252" width="8" height="40" />
      </g>
      <circle cx="320" cy="80" r="34" fill="#E5BC72" opacity="0.85" />
    </svg>
  )
}

export function Cow() {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill="#A8B89C" />
      <rect y="280" width="400" height="120" fill="#6B8E4E" />
      <g transform="translate(200,260)">
        <ellipse cx="0" cy="0" rx="80" ry="50" fill="#F4EDDE" />
        <ellipse cx="-30" cy="-10" rx="20" ry="15" fill="#3A2E1F" />
        <ellipse cx="20" cy="10" rx="25" ry="18" fill="#3A2E1F" />
        <ellipse cx="50" cy="-15" rx="15" ry="12" fill="#3A2E1F" />
        <ellipse cx="-70" cy="-15" rx="22" ry="22" fill="#F4EDDE" />
        <circle cx="-78" cy="-18" r="3" fill="#2B2218" />
        <ellipse cx="-76" cy="-8" rx="4" ry="3" fill="#3A2E1F" />
        <rect x="-30" y="40" width="6" height="30" fill="#3A2E1F" />
        <rect x="-10" y="40" width="6" height="30" fill="#F4EDDE" />
        <rect x="20" y="40" width="6" height="30" fill="#3A2E1F" />
        <rect x="40" y="40" width="6" height="30" fill="#F4EDDE" />
      </g>
      <circle cx="60" cy="80" r="20" fill="#FBF6EA" opacity="0.6" />
      <circle cx="120" cy="60" r="14" fill="#FBF6EA" opacity="0.5" />
      <circle cx="340" cy="100" r="18" fill="#FBF6EA" opacity="0.55" />
    </svg>
  )
}

export function River() {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill="#3A5A45" />
      <path d="M 0 0 L 400 0 L 400 220 Q 300 240 200 235 Q 100 230 0 250 Z" fill="#1E3520" />
      <path d="M 0 250 Q 100 270 200 260 Q 300 250 400 270 L 400 400 L 0 400 Z" fill="#7CADC5" />
      <g stroke="#FBF6EA" strokeWidth="1.2" fill="none" opacity="0.6">
        <path d="M 30 290 Q 80 285 130 290" />
        <path d="M 180 310 Q 230 305 280 310" />
        <path d="M 60 340 Q 120 335 180 340" />
        <path d="M 230 350 Q 290 345 360 350" />
      </g>
      <g fill="#5A4836">
        <ellipse cx="80" cy="320" rx="22" ry="8" />
        <ellipse cx="320" cy="335" rx="28" ry="10" />
        <ellipse cx="180" cy="345" rx="18" ry="6" />
      </g>
    </svg>
  )
}

export function Workshop() {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill="#ECE2CC" />
      <rect y="240" width="400" height="160" fill="#B5532A" opacity="0.2" />
      <line x1="0" y1="240" x2="400" y2="240" stroke="#5A4836" strokeWidth="2" />
      <g transform="translate(120,260)">
        <rect x="-40" y="0" width="80" height="60" fill="#C8923D" />
        <rect x="-38" y="2" width="76" height="6" fill="#8E7440" />
        <line x1="-40" y1="60" x2="-50" y2="120" stroke="#5A4836" strokeWidth="3" />
        <line x1="40" y1="60" x2="50" y2="120" stroke="#5A4836" strokeWidth="3" />
        <circle cx="-10" cy="-20" r="14" fill="#F4EDDE" />
        <rect x="-22" y="-8" width="24" height="36" rx="4" fill="#2C4A2A" />
        <circle cx="20" cy="-22" r="13" fill="#E5BC72" />
        <rect x="10" y="-12" width="22" height="34" rx="4" fill="#B5532A" />
      </g>
      <g transform="translate(280,250)">
        <rect x="-30" y="0" width="60" height="80" fill="#7CADC5" />
        <rect x="-25" y="10" width="50" height="30" fill="#FBF6EA" />
        <line x1="-20" y1="15" x2="20" y2="15" stroke="#3A2E1F" strokeWidth="1" />
        <line x1="-20" y1="22" x2="15" y2="22" stroke="#3A2E1F" strokeWidth="1" />
        <line x1="-20" y1="29" x2="18" y2="29" stroke="#3A2E1F" strokeWidth="1" />
      </g>
      <g fill="#C8923D" opacity="0.7">
        <circle cx="60" cy="80" r="6" />
        <circle cx="340" cy="100" r="4" />
        <circle cx="240" cy="60" r="5" />
      </g>
    </svg>
  )
}

export function Vega() {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F5E6CE" />
          <stop offset="100%" stopColor="#D9A38C" />
        </linearGradient>
      </defs>
      <rect width="400" height="400" fill="url(#vsky)" />
      <path d="M 0 200 L 60 140 L 130 190 L 200 130 L 270 180 L 340 140 L 400 180 L 400 230 L 0 230 Z" fill="#3A5A45" />
      <path d="M 0 230 L 400 230 L 400 280 L 0 290 Z" fill="#6B8E4E" />
      <path d="M 0 290 L 400 280 L 400 400 L 0 400 Z" fill="#2C4A2A" />
      <circle cx="300" cy="100" r="40" fill="#FBF6EA" opacity="0.9" />
      <g fill="#2C4A2A">
        <polygon points="100,310 90,340 110,340" />
        <polygon points="160,320 150,350 170,350" />
        <polygon points="240,315 230,345 250,345" />
        <polygon points="320,325 310,355 330,355" />
      </g>
    </svg>
  )
}

export function Frog() {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill="#5A8DA5" />
      <g fill="#7CADC5" opacity="0.7">
        <ellipse cx="100" cy="100" rx="60" ry="20" />
        <ellipse cx="300" cy="180" rx="80" ry="25" />
        <ellipse cx="150" cy="280" rx="70" ry="22" />
      </g>
      <g transform="translate(200,220)">
        <ellipse cx="0" cy="20" rx="80" ry="60" fill="#6B8E4E" />
        <ellipse cx="-30" cy="-30" rx="20" ry="25" fill="#6B8E4E" />
        <ellipse cx="30" cy="-30" rx="20" ry="25" fill="#6B8E4E" />
        <circle cx="-30" cy="-35" r="10" fill="#FBF6EA" />
        <circle cx="30" cy="-35" r="10" fill="#FBF6EA" />
        <circle cx="-30" cy="-33" r="5" fill="#2B2218" />
        <circle cx="30" cy="-33" r="5" fill="#2B2218" />
        <path d="M -25 20 Q 0 35 25 20" stroke="#2C4A2A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </g>
      <g fill="#C8923D" opacity="0.8">
        <ellipse cx="60" cy="80" rx="15" ry="6" />
        <ellipse cx="340" cy="60" rx="12" ry="5" />
      </g>
    </svg>
  )
}

export function MapMock() {
  return (
    <svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="225" fill="#A8B89C" />
      <path d="M 0 110 Q 80 100 160 120 T 320 100 T 400 110 L 400 225 L 0 225 Z" fill="#6B8E4E" />
      <path d="M 0 150 Q 100 145 200 155 T 400 145 L 400 225 L 0 225 Z" fill="#3A5A45" />
      <path d="M -20 60 Q 100 70 200 50 T 420 70" stroke="#7CADC5" strokeWidth="6" fill="none" opacity="0.7" />
      <g transform="translate(220,120)">
        <circle r="14" fill="#B5532A" />
        <circle r="6" fill="#FBF6EA" />
      </g>
      <text x="240" y="116" fontFamily="Caveat, cursive" fontSize="20" fill="#FBF6EA">AulaVera</text>
    </svg>
  )
}
