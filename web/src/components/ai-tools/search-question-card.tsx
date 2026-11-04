import { AI_TEXTAREA_CLASS, AIButton, AICard, AIPill } from "@/components/ai-tools/ai-ui";

type Props = {
  question: string;
  onQuestionChange: (value: string) => void;
  onInterpret: () => void;
  interpreting: boolean;
  disabled?: boolean;
  explanation: string;
};

export function SearchQuestionCard({ question, onQuestionChange, onInterpret, interpreting, disabled, explanation }: Props) {
  return (
    <AICard>
      <label htmlFor="ai-search-question" className="block text-sm font-semibold text-neutral-800">
        What are you looking for?
      </label>
      <textarea
        id="ai-search-question"
        rows={2}
        className={`${AI_TEXTAREA_CLASS} mt-2 resize-y`}
        placeholder="Ask in plain English, e.g. customers with more than 2 units, or warranty jobs on Marantz receivers"
        value={question}
        onChange={(event) => onQuestionChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && question.trim()) {
            event.preventDefault();
            onInterpret();
          }
        }}
        disabled={interpreting || disabled}
      />
      {explanation && (
        <p className="mt-2 text-sm text-neutral-600" data-testid="ai-search-explanation">
          <span className="font-medium text-[#8a3d10]">Understood as:</span> {explanation}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <AIButton onClick={onInterpret} disabled={interpreting || disabled || !question.trim()}>
          {interpreting ? "Interpreting..." : "Interpret"}
        </AIButton>
        <AIPill>fills the filters below; you can also set them yourself</AIPill>
      </div>
    </AICard>
  );
}
