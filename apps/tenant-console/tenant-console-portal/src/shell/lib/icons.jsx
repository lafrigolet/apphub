// Minimal icon set used by the shell + module manifests. Mirrors the
// shape used in voragine-console so a manifest written for either console
// looks visually consistent. New icons go here, not in the modules.
const s = (d) => (
  <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4">{d}</svg>
)

export const icons = {
  dashboard: s(<><rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="11.5" y="2.5" width="6" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="11.5" y="8.5" width="6" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/></>),
  settings:  s(<><circle cx="10" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  globe:     s(<><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4"/><path d="M2.5 10h15M10 2.5c2 2.5 3 5 3 7.5s-1 5-3 7.5c-2-2.5-3-5-3-7.5s1-5 3-7.5z" stroke="currentColor" strokeWidth="1.4"/></>),
  bell:      s(<><path d="M5 14V9a5 5 0 0110 0v5l1.5 1.5h-13L5 14z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M8.5 17a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.4"/></>),
  tag:       s(<><path d="M3 10l7-7h7v7l-7 7-7-7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><circle cx="13.5" cy="6.5" r="1" fill="currentColor"/></>),
  cart:      s(<><path d="M3 4h2l1.5 9h9l1.5-6H6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/><circle cx="8" cy="16" r="1.4" stroke="currentColor" strokeWidth="1.4"/><circle cx="14" cy="16" r="1.4" stroke="currentColor" strokeWidth="1.4"/></>),
  package:   s(<><path d="M10 2.5L17 6v8l-7 3.5L3 14V6l7-3.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M3 6l7 3.5 7-3.5M10 9.5V17.5" stroke="currentColor" strokeWidth="1.4"/></>),
  truck:     s(<><rect x="2.5" y="6.5" width="9" height="7" stroke="currentColor" strokeWidth="1.4"/><path d="M11.5 8.5h3.5l2.5 3v2h-6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><circle cx="6" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.4"/><circle cx="14" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.4"/></>),
  star:      s(<><path d="M10 2.5l2.4 5 5.5.8-4 3.9 1 5.5-4.9-2.6-4.9 2.6 1-5.5-4-3.9 5.5-.8 2.4-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></>),
  chat:      s(<><path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 3.5V5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></>),
  shield:    s(<><path d="M10 2.5L17 5v5c0 4.5-3 7-7 8-4-1-7-3.5-7-8V5l7-2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></>),
  calendar:  s(<><rect x="2.5" y="4.5" width="15" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M6 2.5v3M14 2.5v3M2.5 8h15" stroke="currentColor" strokeWidth="1.4"/></>),
  user:      s(<><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M3.5 17c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>),
  arrow:     s(<><path d="M4 10h12M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></>),
}
