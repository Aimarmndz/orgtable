"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/app/i18n/client";

type Theme = "light" | "dark" | "system";

const OPTIONS: Theme[] = ["light", "dark", "system"];

// Same key and values as the anti-flicker script in app/layout.tsx and ThemeToggle:
// "light", "dark" or nothing (= follow the system).
function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    // localStorage may be missing (strict private mode): follow the system.
    return "system";
  }
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function applyTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {
    // Without storage the choice lasts until reload; it is applied anyway.
  }
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  listeners.forEach((l) => l());
}

/** Three-option theme picker (the top bar button only toggles light/dark). */
export function ThemePicker() {
  const t = useI18n().m.settings.appearance;
  // There is no localStorage on the server: render "System" and fix it on hydration.
  const current = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  return (
    <fieldset>
      <legend className="sr-only">{t.theme}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((value) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={current === value}
              onChange={() => applyTheme(value)}
              className="mt-1 accent-accent"
            />
            <span>
              <span className="block text-sm font-semibold">{t.themes[value].label}</span>
              <span className="block text-xs text-ink-muted">{t.themes[value].hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
