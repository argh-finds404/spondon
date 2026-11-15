"use client";

import { useState } from "react";

/** A titled block of real code with a copy button. */
export function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure data-ui className="ui-panel min-w-0">
      <figcaption className="flex min-h-10 items-center justify-between gap-4 border-b border-line px-3">
        <span className="ui-label">{title}</span>
        <button
          type="button"
          className="ui-tab text-[12px] font-medium"
          data-on={copied}
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className="p-3 text-ink">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
