const s = (d, extra = {}) => (
  <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" {...extra}>
    {d}
  </svg>
)
const sm = (d) => (
  <svg viewBox="0 0 20 20" fill="none" className="w-3.5 h-3.5">
    {d}
  </svg>
)

export const icons = {
  dashboard: s(<><rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="11.5" y="2.5" width="6" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="11.5" y="8.5" width="6" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/></>),
  tenants:   s(<><path d="M3 17V8l7-5 7 5v9" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M8 17v-5h4v5" stroke="currentColor" strokeWidth="1.4"/></>),
  admins:    s(<><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M3.5 17c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  audit:     s(<><rect x="3.5" y="2.5" width="13" height="15" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  settings:  s(<><circle cx="10" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  danger:    s(<><path d="M10 2.5L17.5 16.5h-15L10 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M10 8v4M10 14.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  staff:     s(<><circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.4"/><circle cx="14" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/><path d="M2.5 16c.5-2.5 2.5-4 4.5-4s4 1.5 4.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M11.5 14c.5-1.5 1.5-2 2.5-2s2 .5 2.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  search:    s(<><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4"/><path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  plus:      s(<><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>),
  close:     s(<><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>),
  chevron:   s(<><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></>),
  chevronR:  s(<><path d="M8 6l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></>),
  arrow:     s(<><path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>, { className: 'w-3.5 h-3.5' }),
  more:      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><circle cx="4" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="16" cy="10" r="1.4"/></svg>,
  check:     s(<><path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>),
  info:      s(<><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4"/><path d="M10 9v5M10 6v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>),
  external:  sm(<><path d="M11 4h5v5M16 4l-7 7M14 10v6H4V6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></>),
  copy:      sm(<><rect x="6" y="6" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M4 14V6a2 2 0 012-2h8" stroke="currentColor" strokeWidth="1.4"/></>),
  bell:      s(<><path d="M5 14V9a5 5 0 0110 0v5l1.5 1.5h-13L5 14z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M8.5 17a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.4"/></>),
  lock:      sm(<><rect x="4" y="9" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M7 9V6a3 3 0 016 0v3" stroke="currentColor" strokeWidth="1.4"/></>),
  globe:     s(<><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4"/><path d="M2.5 10h15M10 2.5c2 2.5 3 5 3 7.5s-1 5-3 7.5c-2-2.5-3-5-3-7.5s1-5 3-7.5z" stroke="currentColor" strokeWidth="1.4"/></>),
  tag:       sm(<><path d="M3 10l7-7h7v7l-7 7-7-7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><circle cx="13.5" cy="6.5" r="1" fill="currentColor"/></>),
  download:  sm(<><path d="M10 3v10m0 0l-4-4m4 4l4-4M3.5 15.5h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  pause:     sm(<><rect x="6" y="4" width="2.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="11.5" y="4" width="2.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.4"/></>),
  play:      sm(<><path d="M6 4v12l10-6-10-6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></>),
  archive:   sm(<><rect x="2.5" y="4" width="15" height="3.5" rx="1" stroke="currentColor" strokeWidth="1.4"/><path d="M4 7.5v8a1 1 0 001 1h10a1 1 0 001-1v-8M8 10.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  transfer:  sm(<><path d="M3 7h11l-3-3M17 13H6l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></>),
  trash:     sm(<><path d="M3.5 5.5h13M8 5.5v-2h4v2M5 5.5l1 10a1 1 0 001 1h6a1 1 0 001-1l1-10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></>),
  eye:       sm(<><path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z" stroke="currentColor" strokeWidth="1.4"/><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4"/></>),
  filter:    sm(<><path d="M3 4h14l-5.5 7v5l-3-2v-3L3 4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></>),
  spark:     sm(<><path d="M10 3v4M10 13v4M3 10h4M13 10h4M5 5l3 3M12 12l3 3M5 15l3-3M12 8l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
}
