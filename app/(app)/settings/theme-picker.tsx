"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

const OPTIONS: { value: Theme; label: string; hint: string }[] = [
  { value: "light", label: "Claro", hint: "Papel cálido" },
  { value: "dark", label: "Oscuro", hint: "Carbón cálido" },
  { value: "system", label: "Del sistema", hint: "Sigue a tu dispositivo" },
];

// Misma clave y valores que el script anti-parpadeo de app/layout.tsx y que ThemeToggle:
// «light», «dark» o nada (= seguir al sistema).
function readTheme(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    // localStorage puede no existir (modo privado estricto): se sigue al sistema.
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
    // Sin almacenamiento la elección dura hasta recargar; se aplica igualmente.
  }
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  listeners.forEach((l) => l());
}

/** Selector de tema con tres opciones (el botón de la barra solo alterna claro/oscuro). */
export function ThemePicker() {
  // En el servidor no hay localStorage: se pinta «Del sistema» y se corrige al hidratar.
  const current = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  return (
    <fieldset>
      <legend className="sr-only">Tema</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3.5 transition-colors hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
          >
            <input
              type="radio"
              name="theme"
              value={o.value}
              checked={current === o.value}
              onChange={() => applyTheme(o.value)}
              className="mt-1 accent-accent"
            />
            <span>
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="block text-xs text-ink-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
