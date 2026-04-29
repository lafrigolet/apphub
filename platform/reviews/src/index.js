import { configurePool } from './lib/db.js'
import { configureRedis } from './lib/redis.js'
import { reviewsRoutes } from './routes/reviews.routes.js'

export { runMigrations } from './lib/migrate.js'

export async function register({ app, db, redis }) {
  configurePool(db)
  configureRedis(redis)

  app.get('/api/reviews/health', { config: { public: true } }, async () => ({
    status: 'ok', module: 'reviews', timestamp: new Date().toISOString(),
  }))

  await app.register(reviewsRoutes)
  // Note: order.delivered is consumed implicitly — buyers can post a review
  // any time after their order reaches a delivered/completed state, and the
  // service trusts the order_id passed in the request body. A future iteration
  // can subscribe and pre-create "review pending" notifications.
}
