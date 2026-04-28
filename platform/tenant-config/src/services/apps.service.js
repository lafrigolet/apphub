import { withTransaction } from '../lib/db.js'
import { pool } from '../lib/db.js'
import * as appsRepo from '../repositories/apps.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

export async function listApps() {
  return withTransaction(pool, (client) => appsRepo.findAll(client))
}

export async function getApp(appId) {
  const app = await withTransaction(pool, (client) => appsRepo.findByAppId(client, appId))
  if (!app) throw new NotFoundError('App')
  return app
}

export async function createApp({ appId, displayName, subdomain, jwtAudience, splitpayEnabled }) {
  try {
    return await withTransaction(pool, (client) =>
      appsRepo.create(client, { appId, displayName, subdomain, jwtAudience, splitpayEnabled }),
    )
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('app_id or subdomain already exists')
    throw err
  }
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
