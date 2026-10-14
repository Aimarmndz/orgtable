import "server-only";
import { LANGUAGES } from "@/locales";

// Server-side view of the language registry (locales/index.ts). Client Components never
// import this file: it pulls every dictionary in. They get what they need as props.

export type Locale = keyof typeof LANGUAGES;
export const LOCALES = Object.keys(LANGUAGES) as Locale[];
export const DEFAULT_LOCALE: Locale = "en";

/** Cookie that stores the chosen language. */
export const LOCALE_COOKIE = "locale";

/** English messages: the reference shape and the fallback for missing translations. */
export type Messages = (typeof LANGUAGES)["en"]["messages"];

export type LanguageInfo = { code: Locale; name: string; intl: string };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.hasOwn(LANGUAGES, value);
}

export function languageInfo(locale: Locale): LanguageInfo {
  const { name, intl } = LANGUAGES[locale].language;
  return { code: locale, name, intl };
}

export function allLanguages(): LanguageInfo[] {
  return LOCALES.map(languageInfo);
}

/**
 * Best supported language for an Accept-Language header, honouring q-values
 * ("es-ES,es;q=0.9,en;q=0.8" → "es"). Falls back to DEFAULT_LOCALE.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const quality = q ? Number(q.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), quality, index };
    })
    .filter((r) => r.tag && Number.isFinite(r.quality) && r.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  // Registered codes may carry a region in upper case ("pt-BR"); browsers vary.
  const byLowerCase = new Map(LOCALES.map((l) => [l.toLowerCase(), l]));
  for (const { tag } of ranked) {
    // Exact code first ("pt-br"), then the base language ("pt").
    const exact = byLowerCase.get(tag) ?? byLowerCase.get(tag.split("-")[0]);
    if (exact) return exact;
  }
  return DEFAULT_LOCALE;
}

type Tree = { [key: string]: string | Tree };

/** `base` with every message present in `override` replaced: missing ones stay English. */
function withFallback(base: Tree, override: unknown): Tree {
  if (!override || typeof override !== "object") return base;
  const out: Tree = {};
  for (const [key, value] of Object.entries(base)) {
    const o = (override as Record<string, unknown>)[key];
    out[key] =
      typeof value === "string"
        ? typeof o === "string" && o !== ""
          ? o
          : value
        : withFallback(value, o);
  }
  return out;
}

const cache = new Map<Locale, Messages>();

/** Messages of a language, completed with English where a translation is missing. */
export function messagesFor(locale: Locale): Messages {
  let messages = cache.get(locale);
  if (!messages) {
    messages =
      locale === "en"
        ? LANGUAGES.en.messages
        : (withFallback(
            LANGUAGES.en.messages as unknown as Tree,
            LANGUAGES[locale].messages,
          ) as unknown as Messages);
    cache.set(locale, messages);
  }
  return messages;
}
