-- Configurable slot step granularity per service. Default 15 min keeps
-- existing behaviour identical; tenants who need 5-min increments (massage)
-- or 30-min (consultations) just override per service.
ALTER TABLE platform_services.services
  ADD COLUMN IF NOT EXISTS step_minutes INT NOT NULL DEFAULT 15
  CHECK (step_minutes > 0 AND step_minutes <= 240);
