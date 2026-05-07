import React from 'react'
import { createRoot } from 'react-dom/client'
import { AdminShell } from '@apphub/tenant-console-ui'
import './index.css'

// Default mount point: tenant-console.apphub.local + per-tenant subdomains
// (acme.apphub.local, …). The shell auto-detects the host subdomain via
// detectHostTenant=true (default) so it can warn about JWT/host mismatch.
createRoot(document.getElementById('root')).render(<AdminShell />)
