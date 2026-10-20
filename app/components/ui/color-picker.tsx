"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { hexToHsv, hsvToHex, normalizeHex, oklchToHex, type Hsv } from "@/app/lib/color-math";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// Any colour: a saturation/brightness square, a hue bar and the hex code, plus optional
// quick colours on top. No library: pointer events on the square (mouse, finger, pen) and
// a native range for the hue. Keyboard on the square: arrows move 1 %, Shift + arrows 10 %.
// `value` is "#rrggbb" or a preset key; `onChange` gets either back.

export type ColorPreset = { key: string; color: string; name: string };

export function ColorPicker({
  value,
  onChange,
  presets = [],
}: {
  value: string;
  onChange: (value: string) => void;
  presets?: ColorPreset[];
}) {
  const { m } = useI18n();
  const t = m.common.colorPicker;
  // A preset is shown in the square and the hex field as its sRGB equivalent.
  const hexOf = (key: string) => {
    const p = presets.find((x) => x.key === key);
    return p ? (oklchToHex(p.color) ?? normalizeHex(p.color)) : normalizeHex(key);
  };
  // The square works in HSV; the hue is kept apart so dragging to grey or black does not
  // reset it to red.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(hexOf(value) ?? "") ?? { h: 20, s: 0.75, v: 0.9 });
  const [draft, setDraft] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const current = hexOf(value);

  function set(next: Hsv) {
    setHsv(next);
    setDraft(null);
    onChange(hsvToHex(next));
  }
  function fromPointer(e: PointerEvent<HTMLDivElement>) {
    const r = area.current?.getBoundingClientRect();
    if (!r) return;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    set({ ...hsv, s: clamp((e.clientX - r.left) / r.width), v: 1 - clamp((e.clientY - r.top) / r.height) });
  }
  function onAreaKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.1 : 0.01;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    set({ ...hsv, s: clamp(hsv.s + d[0]), v: clamp(hsv.v + d[1]) });
  }

  const shown = current ?? hsvToHex(hsv);
  const pct = (x: number) => Math.round(x * 100);

  return (
    <div className="space-y-2.5">
      {presets.length > 0 && (
        <div role="group" aria-label={t.presets} className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              type="button"
              key={p.key}
              onClick={() => {
                setDraft(null);
                const next = hexToHsv(hexOf(p.key) ?? "");
                if (next) setHsv(next);
                onChange(p.key);
              }}
              aria-label={p.name}
              aria-pressed={value === p.key}
              title={p.name}
              style={{ background: p.color }}
              className={`size-6 rounded-full transition ${
                value === p.key ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface" : ""
              }`}
            />
          ))}
        </div>
      )}
      <div
        ref={area}
        role="slider"
        tabIndex={0}
        aria-label={t.area}
        aria-valuetext={fmt(t.areaValue, { s: pct(hsv.s), v: pct(hsv.v) })}
        aria-valuenow={pct(hsv.s)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
        }}
        onKeyDown={onAreaKey}
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
        }}
        className="relative h-36 w-full cursor-crosshair touch-none rounded-lg ring-1 ring-inset ring-black/10 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          aria-hidden="true"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }}
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]"
        />
      </div>
      <input
        type="range"
        min={0}
        max={359}
        value={Math.round(hsv.h)}
        aria-label={t.hue}
        onChange={(e) => set({ ...hsv, h: Number(e.target.value) })}
        className="color-hue h-3 w-full cursor-pointer appearance-none rounded-full"
      />
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5">
        <span aria-hidden="true" style={{ background: shown }} className="size-5 shrink-0 rounded-full ring-1 ring-inset ring-black/10" />
        <span aria-hidden="true" className="font-mono text-sm text-ink-muted">#</span>
        <input
          value={draft ?? shown.slice(1)}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = normalizeHex(e.target.value);
            const next = hex && e.target.value.replace(/^#/, "").length === 6 ? hexToHsv(hex) : null;
            if (hex && next) {
              setHsv(next.s === 0 ? { ...next, h: hsv.h } : next);
              onChange(hex);
            }
          }}
          onBlur={() => {
            const hex = draft === null ? null : normalizeHex(draft);
            if (hex) {
              const next = hexToHsv(hex)!;
              setHsv(next.s === 0 ? { ...next, h: hsv.h } : next);
              onChange(hex);
            }
            setDraft(null);
          }}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={t.hex}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm uppercase text-ink outline-none"
        />
      </div>
    </div>
  );
}
