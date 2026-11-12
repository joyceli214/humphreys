-- Management Ask follow-up memory: remember whether the last answer was about
-- jobs or about parts requests, so "set them to pending" after a parts list is
-- never turned into a job-field Mass Update. Existing rows count as 'jobs'.
ALTER TABLE public.ai_ask_context ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT 'jobs';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_ask_context_topic_check'
      AND conrelid = 'public.ai_ask_context'::regclass
  ) THEN
    ALTER TABLE public.ai_ask_context
      ADD CONSTRAINT ai_ask_context_topic_check CHECK (topic IN ('jobs', 'parts'));
  END IF;
END $$;
