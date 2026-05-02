// aikikan-portal embeds @apphub/tenant-console-ui inline for the admin
// flow (in lieu of redirecting to tenant-console.apphub.local). To make
// Tailwind's JIT see the classNames used inside the shell, the package
// `src/` is added to the content glob and the design tokens come via
// the shared preset.
import preset from '@apphub/tenant-console-ui/tailwind'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
    '../../../packages/tenant-console-ui/src/**/*.{js,jsx}',
  ],
}
