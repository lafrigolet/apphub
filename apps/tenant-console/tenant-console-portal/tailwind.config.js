// Design tokens come from the shared preset (used by every console consumer).
// We only declare the `content` glob — has to include the package's src/
// for Tailwind's JIT to see the classNames used inside the shell/modules.
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
