-- Common contacts (常用聯絡人): addresses owners/admins keep on hand for the
-- Management "Customer Email Drafts" recipient picker (To / Cc).
CREATE TABLE IF NOT EXISTS public.email_common_contacts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_common_contacts_name_check CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  CONSTRAINT email_common_contacts_email_check CHECK (
    btrim(email) <> '' AND char_length(email) <= 254 AND email = lower(btrim(email))
  ),
  CONSTRAINT email_common_contacts_role_check CHECK (role IN ('boss', 'staff', 'other'))
);

CREATE UNIQUE INDEX IF NOT EXISTS email_common_contacts_lower_email_key
  ON public.email_common_contacts (lower(email));

CREATE INDEX IF NOT EXISTS email_common_contacts_list_order_idx
  ON public.email_common_contacts (is_pinned DESC, sort_order ASC, lower(name));
