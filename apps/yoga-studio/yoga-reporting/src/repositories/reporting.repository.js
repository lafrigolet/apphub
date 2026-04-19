export async function getDashboard(client, tenantId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(classes_count), 0) AS total_classes,
       COALESCE(SUM(total_bookings), 0) AS total_bookings,
       COALESCE(SUM(total_attended), 0) AS total_attended,
       COALESCE(SUM(total_no_show), 0) AS total_no_show,
       MAX(active_users) AS active_users
     FROM yoga_reporting.daily_metrics
     WHERE tenant_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'`,
    [tenantId],
  )
  return rows[0]
}

export async function getAttendance(client, tenantId, { from, to }) {
  const conditions = ['m.tenant_id = $1']
  const values = [tenantId]
  let i = 2

  if (from) { conditions.push(`m.date >= $${i++}`); values.push(from) }
  if (to) { conditions.push(`m.date <= $${i++}`); values.push(to) }

  const { rows } = await client.query(
    `SELECT date, classes_count, total_bookings, total_attended, total_no_show
     FROM yoga_reporting.daily_metrics m
     WHERE ${conditions.join(' AND ')}
     ORDER BY date DESC`,
    values,
  )
  return rows
}

export async function upsertDailyMetric(client, tenantId, date, field, delta = 1) {
  await client.query(
    `INSERT INTO yoga_reporting.daily_metrics (tenant_id, date, ${field})
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, date) DO UPDATE
     SET ${field} = yoga_reporting.daily_metrics.${field} + EXCLUDED.${field}`,
    [tenantId, date, delta],
  )
}

export async function createRating(client, { id, bookingId, userId, classId, instructorId, stars, comment, tenantId, subTenantId }) {
  const { rows } = await client.query(
    `INSERT INTO yoga_reporting.ratings (id, booking_id, user_id, class_id, instructor_id, stars, comment, tenant_id, sub_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (booking_id) DO NOTHING
     RETURNING *`,
    [id, bookingId, userId, classId ?? null, instructorId ?? null, stars, comment ?? null, tenantId, subTenantId ?? null],
  )
  return rows[0] ?? null
}

export async function getInstructorRatings(client, instructorId, tenantId) {
  const { rows } = await client.query(
    `SELECT s.avg_rating, s.total_ratings, s.updated_at,
       json_agg(json_build_object('stars', r.stars, 'comment', r.comment, 'created_at', r.created_at)
         ORDER BY r.created_at DESC) AS recent_ratings
     FROM yoga_reporting.instructor_ratings_summary s
     LEFT JOIN yoga_reporting.ratings r ON r.instructor_id = s.instructor_id AND r.tenant_id = s.tenant_id
     WHERE s.instructor_id = $1 AND s.tenant_id = $2
     GROUP BY s.instructor_id, s.avg_rating, s.total_ratings, s.updated_at`,
    [instructorId, tenantId],
  )
  return rows[0] ?? { avg_rating: null, total_ratings: 0, recent_ratings: [] }
}

export async function upsertInstructorSummary(client, instructorId, tenantId) {
  await client.query(
    `INSERT INTO yoga_reporting.instructor_ratings_summary (instructor_id, avg_rating, total_ratings, updated_at, tenant_id)
     SELECT instructor_id, AVG(stars), COUNT(*), now(), $2
     FROM yoga_reporting.ratings
     WHERE instructor_id = $1 AND tenant_id = $2
     GROUP BY instructor_id
     ON CONFLICT (instructor_id) DO UPDATE SET
       avg_rating = EXCLUDED.avg_rating,
       total_ratings = EXCLUDED.total_ratings,
       updated_at = EXCLUDED.updated_at`,
    [instructorId, tenantId],
  )
}
