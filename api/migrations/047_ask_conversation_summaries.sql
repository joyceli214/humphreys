-- Management Ask: one short factual summary per closed conversation, per login.
-- Kept for 2 days; older rows are deleted on request and at API startup.
CREATE TABLE IF NOT EXISTS public.ai_ask_conversation_summaries (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_ask_conversation_summaries_user_created_idx
  ON public.ai_ask_conversation_summaries (user_id, created_at DESC);
