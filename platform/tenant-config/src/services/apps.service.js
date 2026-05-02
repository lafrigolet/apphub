import { withTransaction } from '../lib/db.js'
import { pool } from '../lib/db.js'
import * as appsRepo from '../repositories/apps.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'
import { writeAppNginxConfig } from './nginx-config.service.js'
import { logger } from '../lib/logger.js'

export async function listApps() {
  return withTransaction(pool, (client) => appsRepo.findAll(client))
}

export async function getApp(appId) {
  const app = await withTransaction(pool, (client) => appsRepo.findByAppId(client, appId))
  if (!app) throw new NotFoundError('App')
  return app
}

export async function createApp({ appId, displayName, subdomain, jwtAudience, splitpayEnabled }) {
  let app
  try {
    app = await withTransaction(pool, (client) =>
      appsRepo.create(client, { appId, displayName, subdomain, jwtAudience, splitpayEnabled }),
    )
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('app_id or subdomain already exists')
    throw err
  }

  // Publish NGINX server block to Redis. Best-effort: if Redis is down the
  // app row is already committed; staff can re-trigger by toggling the app
  // or via a future reconcile job. We don't roll back the DB transaction.
  try {
    await writeAppNginxConfig({ appId: app.app_id, subdomain: app.subdomain })
  } catch (err) {
    logger.warn({ err, appId: app.app_id }, 'Failed to publish NGINX conf — app created but routing not provisioned')
  }

  return app
}

export async function setAppStatus(appId, status) {
  const app = await withTransaction(pool, (client) => appsRepo.updateStatus(client, appId, status))
  if (!app) throw new NotFoundError('App')
  return app
}

export async function setAppSplitpayEnabled(appId, enabled) {
  const app = await withTransaction(pool, (client) => appsRepo.updateSplitpayEnabled(client, appId, enabled))
  if (!app) throw new NotFoundError('App')
  return app
}

export async function setAppEnabledModules(appId, modules) {
  const app = await withTransaction(pool, (client) => appsRepo.updateEnabledModules(client, appId, modules))
  if (!app) throw new NotFoundError('App')
  return app
}
