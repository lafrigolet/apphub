// Public surface of @apphub/tenant-console-ui.
//
// Two consumers today: tenant-console-portal (renders the shell with
// its default settings) and aikikan-portal (mounts the shell inline
// for an admin-role login, with `detectHostTenant=false` and its own
// `tokenKey`). New consumers should prefer the same shape — pass
// configuration as props or via configureAuth() before mounting.

export { default as AdminShell } from './App.jsx'
export { AppProvider, useApp }   from './shell/lib/context.jsx'
export { configureAuth, login, logout, getToken, getIdentity } from './shell/lib/auth.js'
export { api }                   from './shell/lib/api.js'
