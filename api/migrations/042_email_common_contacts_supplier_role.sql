-- Adds the 'supplier' role to common contacts so the Management Supplier email
-- flow can pick a supplier as To. Idempotent: safe to run more than once.
ALTER TABLE public.email_common_contacts
  DROP CONSTRAINT IF EXISTS email_common_contacts_role_check;

ALTER TABLE public.email_common_contacts
  ADD CONSTRAINT email_common_contacts_role_check CHECK (role IN ('boss', 'staff', 'other', 'supplier'));
