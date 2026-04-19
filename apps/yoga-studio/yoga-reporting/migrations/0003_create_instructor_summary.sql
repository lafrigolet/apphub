CREATE TABLE IF NOT EXISTS yoga_reporting.instructor_ratings_summary (
  instructor_id  UUID PRIMARY KEY,
  avg_rating     DECIMAL(3,2),
  total_ratings  INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
