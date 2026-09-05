import type { ReactNode } from "react";

export function FieldLabel({ text, tip }: { text: string; tip: string }): ReactNode {
  return (
    <span className="field-label">
      {text}
      <span className="tip" data-tip={tip} title={tip} aria-label={tip}>
        ?
      </span>
    </span>
  );
}
