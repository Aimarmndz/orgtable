import en from "./en";
import es from "./es";

// Languages of the interface. English (`en`) is the reference: every other language is
// checked against it (test/i18n.test.ts) and falls back to it for any missing message.
//
// To add a language, copy `en/` to `<code>/`, translate the JSON files, set
// `language.json`, and add one line below. Step by step: locales/README.md.
export const LANGUAGES = {
  en,
  es,
};
