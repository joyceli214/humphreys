import { AIPill } from "@/components/ai-tools/ai-ui";

type Capability = {
  title: string;
  detail?: string;
  isNew?: boolean;
  examples: string[];
};

const CAPABILITIES: Capability[] = [
  {
    title: "Change status",
    examples: ["Set jobs 31195 and 31196 to Ready for pickup."]
  },
  {
    title: "Add, change or remove line items",
    examples: ["Add a Belt Kit / Shipping line to job 31152.", "Remove the Audio Cable line from job 31174."]
  },
  {
    title: "Change the labour total or discount",
    examples: ["Set the labour total on job 31198 to $294.", "Give job 31199 a 10% labour discount."]
  },
  {
    title: "Change the location",
    examples: ["Move jobs 31185 and 31190 to location A-1."]
  },
  {
    title: "Generate Work Done",
    detail: "Written from each job's repair logs, for up to 10 jobs per request.",
    isNew: true,
    examples: ["Generate Work Done for jobs 31152 and 31153."]
  }
];

type Props = {
  /** Called with the example text; the parent replaces the instruction with it. */
  onExample: (text: string) => void;
  disabled?: boolean;
};

/** "What Mass Update can do" panel with clickable example instructions. */
export function MassUpdateCapabilities({ onExample, disabled = false }: Props) {
  return (
    <details open className="group rounded-lg border border-[#e8e2db] bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-800">What Mass Update can do</summary>
      <p className="mt-1 text-xs text-neutral-500">Click an example to put it in the instruction box, then change the job numbers.</p>
      <ul className="mt-3 space-y-2.5">
        {CAPABILITIES.map((item) => (
          <li key={item.title} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-neutral-800">{item.title}</span>
              {item.isNew && <AIPill tone="orange">New</AIPill>}
            </div>
            {item.detail && <p className="text-xs text-neutral-500">{item.detail}</p>}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {item.examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={disabled}
                  onClick={() => onExample(example)}
                  className="rounded-md border border-[#ddd5cc] bg-[#faf8f6] px-2 py-1 text-left text-xs text-neutral-700 transition hover:border-[#c2571a] hover:text-[#8a3d10] disabled:pointer-events-none disabled:opacity-50"
                >
                  {example}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
