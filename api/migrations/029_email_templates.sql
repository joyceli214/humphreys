CREATE TABLE IF NOT EXISTS public.email_templates (
  template_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_email_templates_template_key CHECK (template_key IN ('job_started', 'job_completed'))
);

INSERT INTO public.email_templates (template_key, label, subject_template, body_template)
VALUES
  (
    'job_started',
    'Job Started Email',
    'Job #{{reference_id}} started - {{equipment_name}}',
    'Hi {{customer_name}},

We have started work on your {{equipment_name}}.

Job details:
Job ID: {{reference_id}}
Item: {{equipment_name}}
Status: {{status_name}}
Serial: {{serial_number}}
Problem: {{problem_description}}
Work done: {{work_done}}
Estimated total before deposit: {{total_before_deposit}}
Deposit: {{deposit}}

We will contact you if we need approval for parts or additional work.

Thank you,
Humphreys Electronics'
  ),
  (
    'job_completed',
    'Job Completed Email',
    'Job #{{reference_id}} completed - {{equipment_name}}',
    'Hi {{customer_name}},

Your repair job for {{equipment_name}} is complete.

Job details:
Job ID: {{reference_id}}
Item: {{equipment_name}}
Status: {{status_name}}
Serial: {{serial_number}}
Problem: {{problem_description}}
Work done: {{work_done}}
Estimated total before deposit: {{total_before_deposit}}
Deposit: {{deposit}}

Please contact us if you have any questions or would like to arrange pickup or delivery.

Thank you,
Humphreys Electronics'
  )
ON CONFLICT (template_key) DO NOTHING;
