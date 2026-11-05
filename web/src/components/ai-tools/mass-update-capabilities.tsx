import { AIPill } from "@/components/ai-tools/ai-ui";
import { CAPABILITIES, getTemplate, type TemplateId } from "@/lib/ai-tools/mass-update-templates";

type Props = {
  /** Called with the template id; the parent shows its fill-in slots. */
  onExample: (id: TemplateId) => void;
  disabled?: boolean;
};

/** "What Mass Update can do" panel with clickable example templates. */
export function MassUpdateCapabilities({ onExample, disabled = false }: Props) {
  return (
    <details open className="group rounded-lg border border-[#e8e2db] bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-800">What Mass Update can do</summary>
      <p className="mt-1 text-xs text-neutral-500">Click an example, then fill in the boxes above the instruction.</p>
      <ul className="mt-3 space-y-2.5">
        {CAPABILITIES.map((item) => (
          <li key={item.title} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-neutral-800">{item.title}</span>
              {item.isNew && <AIPill tone="orange">New</AIPill>}
            </div>
            {item.detail && <p className="text-xs text-neutral-500">{item.detail}</p>}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {item.templates.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onExample(id)}
                  className="rounded-md border border-[#ddd5cc] bg-[#faf8f6] px-2 py-1 text-left text-xs text-neutral-700 transition hover:border-[#c2571a] hover:text-[#8a3d10] disabled:pointer-events-none disabled:opacity-50"
                >
                  {getTemplate(id).label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
