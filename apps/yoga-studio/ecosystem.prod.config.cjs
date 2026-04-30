// Production PM2 ecosystem for yoga-studio.
// Excludes yoga-portal — in prod the portal runs as its own nginx-alpine
// container (apps/yoga-studio/yoga-portal/Dockerfile target=production).
// This container only hosts the 5 backend services.
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
  ],
}
