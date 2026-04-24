CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL,
  preference_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, preference_key)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);
