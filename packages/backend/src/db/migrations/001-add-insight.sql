-- Add historical insight payload for convergence events
ALTER TABLE convergence_events
ADD COLUMN IF NOT EXISTS historical_insight JSONB;
