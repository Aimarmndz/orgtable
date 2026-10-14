// Message helpers shared by server and client. Messages are plain JSON (strings and plural
// objects), so they can travel from Server to Client Components as props.

/** A message with plural forms, picked with Intl.PluralRules ("one", "other"…). */
export type Plural = { one: string; other: string; zero?: string; few?: string; many?: string };

export type Params = Record<string, string | number>;

/** Replaces {name} placeholders. A missing parameter stays visible as {name}. */
export function fmt(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Picks the plural form for `count` in the language `intl` (a BCP 47 tag such as "es-ES")
 * and fills {count} plus any other parameters. Falls back to "other".
 */
export function plural(intl: string, forms: Plural, count: number, params: Params = {}): string {
  const category = new Intl.PluralRules(intl).select(count);
  const template = (forms as Record<string, string | undefined>)[category] ?? forms.other;
  return fmt(template, { count, ...params });
}

/**
 * Message at a dotted path ("errors.validation.titleRequired"), or undefined. Used for
 * zod issues, whose `message` is a key so that schemas stay language-independent.
 */
export function messageAt(messages: unknown, path: string): string | undefined {
  let node: unknown = messages;
  for (const key of path.split(".")) {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, key)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" ? node : undefined;
}
