package aisettings

const DefaultOpenRouterModel = "google/gemma-3-27b-it:free"

const DefaultSystemPrompt = "You summarize technician work orders. Write short, factual natural language in paragraph form. Use 1-2 paragraphs only. Do not use bullet points, numbered lists, or headings."

const DefaultWorkOrderSummaryPrompt = `Write a single natural-language technician summary in 60 words max.
Output MUST be in paragraph form in natural language (1 short paragraph; maximum 2 paragraphs).
Bold these information with **...**: customer name, phone, email, equipment brand/type/model, required actions.
Do not use bullet points, numbered lists, markdown headings, or filler words.
Must include: customer name, phone, email, equipment brand, equipment type, model (if present).
Must include: repair logs summary with technician name(s) and key work done.
Must include: actions required (e.g., pending parts approval, awaiting customer pickup), if any.
Include only facts from provided data. If missing, say "Unknown".

{{work_order_data}}
`

const DefaultWorkDonePrompt = `Write only the customer-facing "Work Done" content based strictly on repair logs.
Output rules:
- Return plain paragraph text only.
- No headings, no labels, no bullet points, no numbered lists.
- Do not include customer info, equipment info, pricing, status, or any unrelated fields.
- Do not invent facts.
- Rewrite internal/technical note phrasing into clear customer-facing service language.
- Never use phrases like "owner reported", "customer reported", "no further details", "unspecified item", or similar uncertainty/disclaimer wording.
- Focus on what was checked, diagnosed, repaired, adjusted, cleaned, replaced, tested, or confirmed.
- Use passive voice throughout.
- Do not mention any person, technician, owner, customer, or staff member.
- Describe outcomes as completed actions (for example: "was inspected", "was repaired", "was tested", "was confirmed").
- Start immediately with the completed work. No introductory lead-in phrases.
- Never start with or include phrases like "The repair logs indicate that", "It was noted that", "It was reported that", or similar preambles.
- If there are no repair logs, return exactly: No repair work has been logged yet.

Repair logs summary:
{{repair_logs_summary}}
`
