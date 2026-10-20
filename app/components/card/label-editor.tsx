"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { LabelDTO } from "@/app/lib/types";
import { LABEL_COLORS, LABEL_COLOR_KEYS, labelBackground, labelText } from "@/app/lib/colors";
import { createLabel, deleteLabel, updateLabel } from "@/app/lib/actions/labels";
import { Button } from "../ui/button";
import { ColorPicker } from "../ui/color-picker";
import { runToggle } from "./card-modal-helpers";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// Renames a label, changes its colour or deletes it (after an inline confirmation, as with
// cards). Shared by the card modal and the board menu; owners only, which updateLabel and
// deleteLabel check again. See docs/board-menu.md.

const smallInput =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25";

export function LabelEditor({ label, onDone }: { label: LabelDTO; onDone: () => void }) {
  const { m } = useI18n();
  const t = m.boards.cardModal;
  const nameId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(label.name);
  // A palette key or "#rrggbb"; updateLabel validates it again.
  const [color, setColor] = useState(label.color);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit(action: () => Promise<{ ok: boolean }>, context: string) {
    startTransition(async () => {
      const failed = await runToggle(action, t.labelSaveFailed, context);
      if (failed) setError(failed);
      else onDone();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        submit(() => updateLabel({ labelId: label.id, name, color }), "updateLabel");
      }}
      onKeyDown={(e) => {
        // Escape leaves the editor, not the dialog or menu around it.
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      className="space-y-2.5 rounded-xl border border-border bg-surface-2/60 p-3"
    >
      <label htmlFor={nameId} className="block text-xs font-semibold text-ink-muted">
        {t.labelName}
      </label>
      <input
        ref={inputRef}
        id={nameId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={40}
        className={smallInput}
      />
      <ColorPicker
        value={color}
        onChange={setColor}
        presets={LABEL_COLOR_KEYS.map((k) => ({
          key: k,
          color: LABEL_COLORS[k],
          name: fmt(t.labelColor, { color: t.colors[k] }),
        }))}
      />
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-sm text-ink">{t.deleteLabelPrompt}</span>
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => submit(() => deleteLabel({ labelId: label.id }), "deleteLabel")}
          >
            {m.common.actions.delete}
          </Button>
          <Button type="button" variant="subtle" onClick={() => setConfirming(false)}>
            {m.boards.confirm.no}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="subtle" disabled={pending}>
            {pending ? m.common.actions.saving : m.common.actions.save}
          </Button>
          <Button type="button" variant="subtle" onClick={onDone}>
            {m.common.actions.cancel}
          </Button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ml-auto rounded-lg px-2 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            {t.deleteLabel}
          </button>
        </div>
      )}
    </form>
  );
}

/** Creates a label on the board: a palette colour or any other from the picker. */
export function NewLabelForm({ boardId }: { boardId: string }) {
  const { m } = useI18n();
  const t = m.boards.cardModal;
  const ref = useRef<HTMLFormElement>(null);
  // A palette key or "#rrggbb" from the picker; createLabel validates it again.
  const [color, setColor] = useState<string>(LABEL_COLOR_KEYS[0]);
  const [picking, setPicking] = useState(false);
  const custom = !(LABEL_COLOR_KEYS as string[]).includes(color);

  return (
    <form
      ref={ref}
      action={async (formData) => {
        await createLabel(formData);
        ref.current?.reset();
        setPicking(false);
      }}
      className="mt-3 space-y-2"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="color" value={color} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {LABEL_COLOR_KEYS.map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setColor(k)}
              aria-label={fmt(t.labelColor, { color: t.colors[k] })}
              aria-pressed={color === k}
              style={{ background: LABEL_COLORS[k] }}
              className={`size-5 rounded-full transition ${
                color === k
                  ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
                  : ""
              }`}
            />
          ))}
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            aria-label={m.common.colorPicker.custom}
            aria-expanded={picking}
            title={m.common.colorPicker.custom}
            style={{
              background: custom
                ? color
                : "conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
            className={`size-5 rounded-full transition ${
              custom ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface" : ""
            }`}
          />
        </div>
        <input
          name="name"
          required
          maxLength={40}
          placeholder={t.newLabel}
          aria-label={t.newLabelName}
          className={`${smallInput} min-w-32 flex-1`}
        />
        <Button type="submit" variant="subtle" className="px-3 py-1.5">
          {t.add}
        </Button>
      </div>
      {picking && (
        <div className="max-w-xs">
          <ColorPicker value={color} onChange={setColor} />
        </div>
      )}
    </form>
  );
}

/** Every label of the board, each editable in place, and a new one at the end (board menu). */
export function LabelManager({ boardId, labels }: { boardId: string; labels: LabelDTO[] }) {
  const { m } = useI18n();
  const t = m.boards.cardModal;
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="space-y-1 p-1.5">
      {labels.length === 0 && <p className="px-1 text-sm text-ink-muted">{m.boards.menu.noLabels}</p>}
      {labels.map((l) =>
        editing === l.id ? (
          <LabelEditor key={l.id} label={l} onDone={() => setEditing(null)} />
        ) : (
          <button
            key={l.id}
            type="button"
            onClick={() => setEditing(l.id)}
            aria-label={fmt(t.editLabel, { name: l.name })}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
          >
            <span
              className="min-w-0 truncate rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ background: labelBackground(l.color), color: labelText(l.color) }}
            >
              {l.name}
            </span>
            <span className="ml-auto text-xs text-ink-muted">{m.common.actions.edit}</span>
          </button>
        ),
      )}
      <NewLabelForm boardId={boardId} />
    </div>
  );
}
