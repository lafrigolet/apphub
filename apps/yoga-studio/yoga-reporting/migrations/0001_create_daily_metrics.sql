CREATE TABLE IF NOT EXISTS yoga_reporting.daily_metrics (
  date            DATE PRIMARY KEY,
  classes_count   INT NOT NULL DEFAULT 0,
  total_bookings  INT NOT NULL DEFAULT 0,
  total_attended  INT NOT NULL DEFAULT 0,
  total_no_show   INT NOT NULL DEFAULT 0,
  active_users    INT NOT NULL DEFAULT 0
);
