-- Email Templates page groups (Customer / Supplier / Shop) for the Management
-- email flow. Adds a kind column and four built-in Supplier / Shop templates.
-- Supplier and Shop bodies carry exactly one {{job_cards}} slot, filled from
-- the picked jobs on the Write step. The live job_started / job_completed rows
-- are not changed. Idempotent: safe to run more than once.
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE public.email_templates
  DROP CONSTRAINT IF EXISTS chk_email_templates_kind;

ALTER TABLE public.email_templates
  ADD CONSTRAINT chk_email_templates_kind CHECK (kind IN ('customer', 'supplier', 'shop'));

ALTER TABLE public.email_templates
  DROP CONSTRAINT IF EXISTS chk_email_templates_template_key;

ALTER TABLE public.email_templates
  ADD CONSTRAINT chk_email_templates_template_key CHECK (template_key IN (
    'job_started',
    'job_completed',
    'supplier_parts_inquiry',
    'supplier_order_followup',
    'shop_approval',
    'shop_update'
  ));

INSERT INTO public.email_templates (template_key, kind, label, subject_template, body_template)
VALUES
  (
    'supplier_parts_inquiry',
    'supplier',
    'Parts inquiry',
    'Parts inquiry – Jobs {{job_numbers}} (Acct {{account_number}})',
    'Hi {{supplier_name}},

Could you please confirm price and stock for these parts?

{{job_cards}}

Please reply with price and lead time.

Thanks,
Justin
Humphreys Electronics'
  ),
  (
    'supplier_order_followup',
    'supplier',
    'Order follow-up',
    'Order follow-up – Jobs {{job_numbers}} (Acct {{account_number}})',
    'Hi {{supplier_name}},

Could you let us know where these parts are and when they will ship?

{{job_cards}}

Thanks,
Justin
Humphreys Electronics'
  ),
  (
    'shop_approval',
    'shop',
    'Ask for approval',
    'Approval needed – Jobs {{job_numbers}}',
    'Hi {{recipient_name}},

Please approve the parts and work below.

{{job_cards}}

Reply “yes” and we can order / start.

Thanks,
Justin
Humphreys Electronics'
  ),
  (
    'shop_update',
    'shop',
    'Ask for an update',
    'Please update – Jobs {{job_numbers}}',
    'Hi {{recipient_name}},

Please send a short update on these jobs.

{{job_cards}}

A few lines on each job is enough.

Thanks,
Dave
Humphreys Electronics'
  )
ON CONFLICT (template_key) DO NOTHING;
