import { describe, it, expect } from "vitest";
import { LANGUAGES } from "@/locales";
import { messagesFor, negotiateLocale } from "@/app/i18n/config";
import { fmt, plural, messageAt } from "@/app/i18n/format";

// Translation checks (CI). English is the reference: every registered language must have
// the same messages, with the same {placeholders} and <tags>, and plural forms for the
// categories its grammar uses. How to add a language: locales/README.md.

type Tree = { [key: string]: unknown };

function leaves(tree: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!tree || typeof tree !== "object") return out;
  for (const [key, value] of Object.entries(tree as Tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlural(value) || typeof value === "string") out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

function isPlural(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    "other" in value &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** Placeholders and tags of a message (or of all forms of a plural), sorted. */
function tokens(value: unknown): string[] {
  const texts = typeof value === "string" ? [value] : Object.values(value as Tree);
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of String(t).matchAll(/\{(\w+)\}|<\/?(\w+)>/g)) found.add(m[0]);
  }
  return [...found].filter((t) => t !== "{count}").sort();
}

const reference = leaves(LANGUAGES.en.messages);
const others = Object.entries(LANGUAGES).filter(([code]) => code !== "en");

describe.each(others)("language %s", (code, lang) => {
  const translated = leaves(lang.messages);

  it("language.json matches its folder and has a valid Intl tag", () => {
    expect(lang.language.code).toBe(code);
    expect(lang.language.name).not.toBe("");
    expect(() => new Intl.PluralRules(lang.language.intl)).not.toThrow();
  });

  it("has every English message", () => {
    const missing = [...reference.keys()].filter((k) => !translated.has(k));
    expect(missing, `Missing in locales/${code}/`).toEqual([]);
  });

  it("has no messages that English does not have", () => {
    const extra = [...translated.keys()].filter((k) => !reference.has(k));
    expect(extra, `Unknown keys in locales/${code}/ (renamed or removed in English?)`).toEqual([]);
  });

  it("keeps the same {placeholders} and <tags>", () => {
    const mismatched = [...reference.entries()]
      .filter(([k]) => translated.has(k))
      .filter(([k, v]) => tokens(v).join() !== tokens(translated.get(k)).join())
      .map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it("plurals have the forms this language needs", () => {
    const rules = new Intl.PluralRules(lang.language.intl);
    const needed = new Set(Array.from({ length: 201 }, (_, n) => rules.select(n)));
    const incomplete = [...reference.entries()]
      .filter(([, v]) => isPlural(v))
      .filter(([k]) => {
        const forms = translated.get(k);
        return !isPlural(forms) || [...needed].some((c) => !(c in forms));
      })
      .map(([k]) => k);
    expect(incomplete).toEqual([]);
  });
});

describe("i18n helpers", () => {
  it("negotiates the language from Accept-Language with q-values", () => {
    expect(negotiateLocale("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
    expect(negotiateLocale("fr-FR,fr;q=0.9,en;q=0.5")).toBe("en");
    expect(negotiateLocale("de;q=0.9,es;q=0.4")).toBe("es");
    expect(negotiateLocale("")).toBe("en");
    expect(negotiateLocale(null)).toBe("en");
  });

  it("fills placeholders and picks plural forms", () => {
    expect(fmt("Hello {name}", { name: "Ana" })).toBe("Hello Ana");
    expect(fmt("Hello {name}")).toBe("Hello {name}");
    const forms = { one: "{count} card", other: "{count} cards" };
    expect(plural("en", forms, 1)).toBe("1 card");
    expect(plural("en", forms, 3)).toBe("3 cards");
  });

  it("resolves message keys and falls back to English for missing translations", () => {
    const es = messagesFor("es");
    expect(messageAt(es, "common.actions.save")).toBe("Guardar");
    expect(messageAt(es, "common.nope")).toBeUndefined();
    expect(messageAt(es, "constructor")).toBeUndefined();
  });
});
