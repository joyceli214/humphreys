-- Management Ask follow-up memory: one small row per login account holding the
-- job numbers (and/or customer search) from that user's last Ask answer, so a
-- follow-up like "update both to Finished" works across devices. No message
-- text is stored. Rows older than 5 days are ignored and deleted on read.
CREATE TABLE IF NOT EXISTS public.ai_ask_context (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  reference_ids BIGINT[] NOT NULL DEFAULT '{}',
  customer_query TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
