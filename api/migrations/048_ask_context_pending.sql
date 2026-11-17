-- Management Ask: a question Ask asked and is waiting on (labour amount or
-- repair log hours), e.g. {"kind":"labour","reference_id":31221,"hours":1}.
-- Only the next message can answer it; any other request, New conversation
-- or the context expiring clears it. NULL when nothing is pending.
ALTER TABLE public.ai_ask_context ADD COLUMN IF NOT EXISTS pending JSONB NULL;
