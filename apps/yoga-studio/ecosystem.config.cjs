module.exports = {
  apps: [
    {
      name: 'yoga-users',
      script: 'src/server.js',
      cwd: '/app/apps/yoga-studio/yoga-users',
    },
    {
      name: 'yoga-classes',
      script: 'src/server.js',
      cwd: '/app/apps/yoga-studio/yoga-classes',
    },
    {
      name: 'yoga-bookings',
      script: 'src/server.js',
      cwd: '/app/apps/yoga-studio/yoga-bookings',
    },
    {
      name: 'yoga-bonuses',
      script: 'src/server.js',
      cwd: '/app/apps/yoga-studio/yoga-bonuses',
    },
    {
      name: 'yoga-reporting',
      script: 'src/server.js',
      cwd: '/app/apps/yoga-studio/yoga-reporting',
    },
    {
      name: 'yoga-portal',
      script: 'node_modules/vite/bin/vite.js',
      args: '--host',
      cwd: '/app/apps/yoga-studio/yoga-portal',
    },
  ],
}
