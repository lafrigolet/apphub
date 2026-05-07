// Dynamic loader for module manifests. Fed by `apps.enabled_modules`,
// returns an array of imported manifests. A capability whose manifest
// can't be loaded (file missing, throws at import) is silently dropped
// — the shell logs it and keeps going, so a broken module doesn't take
// the whole console down.
//
// Vite's `import.meta.glob` with `eager: false` produces a map of module
// path → loader function; we look up the path matching the capability id.

const manifestModules = import.meta.glob('../modules/*/manifest.jsx')

export async function loadManifests(enabledModules) {
  const wanted = new Set(enabledModules ?? [])
  const out = []
  for (const [path, loader] of Object.entries(manifestModules)) {
    // path is like '../modules/notifications/manifest.jsx'
    const id = path.split('/').slice(-2, -1)[0]
    if (!wanted.has(id)) continue
    try {
      const mod = await loader()
      const manifest = mod.default ?? mod
      if (!manifest?.id) continue
      out.push(manifest)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[tenant-console] failed to load manifest for ${id}:`, err)
    }
  }
  return out
}
