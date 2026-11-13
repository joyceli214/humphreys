-- Management Ask conversation memory: the last few turns (typed text plus a
-- short server-built summary of each answer) so the model can resolve
-- follow-ups like "update their status to picked up". The server keeps at most
-- 12 turns; rows older than 5 days are still ignored and deleted on read.
ALTER TABLE public.ai_ask_context ADD COLUMN IF NOT EXISTS turns JSONB NOT NULL DEFAULT '[]'::jsonb;
