"use client";

import { useEffect, useRef, useState } from "react";

// Copy button of the install command (landing). The command stays selectable text next to
// it, so copying by hand always works; the status is announced to screen readers.
export function CopyCommand({
  command,
  labels,
}: {
  command: string;
  labels: { copy: string; copied: string; copyFailed: string };
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      // No clipboard access (plain http, permissions): say how to do it by hand.
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="min-h-11 shrink-0 rounded-[3px] border-2 border-phosphor bg-phosphor px-3.5 font-pixel text-[13px] text-terminal transition-transform active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-phosphor"
      >
        {state === "copied" ? labels.copied : labels.copy}
      </button>
      <span role="status" className="sr-only">
        {state === "copied"
          ? labels.copied
          : state === "failed"
            ? labels.copyFailed
            : ""}
      </span>
      {state === "failed" && (
        <span className="basis-full font-sans text-sm text-phosphor-dim">
          {labels.copyFailed}
        </span>
      )}
    </>
  );
}
