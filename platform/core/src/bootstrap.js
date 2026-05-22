// Entrypoint del contenedor (`node src/bootstrap.js`). La lógica de boot
// vive en server.js#start; aquí solo orquestamos la llamada y el
// fail-fast con process.exit(1).
//
// Separar este fichero permite que los tests importen `server.js` y
// controlen `start()` con mocks sin disparar el listen() del top-level.

import { start } from './server.js'

start().catch((err) => {
  console.error('Failed to start platform-core:', err)
  process.exit(1)
})
