# Translating orgtable

Every piece of text in the interface lives here, one folder per language and one JSON file
per area of the app. You do not need to know the code to translate it.

```
locales/
├── index.ts          # the list of languages (one line each)
├── en/               # English: the reference, always complete
│   ├── language.json # code, native name and Intl tag of the language
│   ├── index.ts      # the same in every folder: copy it as is
│   ├── common.json   # shared words, language picker
│   ├── auth.json     # sign in, sign up, first-run setup
│   ├── nav.json      # top bar, account menu, notifications, search box
│   ├── boards.json   # boards, lists, cards, filters, calendar, members
│   ├── settings.json # the settings page
│   ├── admin.json    # administration: users, instance, audit log
│   ├── search.json   # search page
│   ├── legal.json    # privacy policy, terms, cookies, legal notice, footer
│   ├── errors.json   # validation and error messages
│   ├── notifications.json # in-app notification texts
│   ├── landing.json  # the public landing page at /
│   ├── workspaces.json # organizations, members and employees
│   ├── emails.json   # the emails (password reset, invitation)
│   ├── webhooks.json # webhooks, integrations and what they post to chats
│   └── backups.json  # backups, export and import
└── es/               # Spanish
```

## Improve an existing translation

Edit the JSON file and open a pull request. That's it.

## Add a language

1. Copy `en/` to a folder named with the language code, e.g. `fr/` or `pt-BR/`. Use the
   two-letter [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) code,
   plus a region only when it matters, e.g. `pt-BR`.
2. In `language.json`, set `code` (the folder name), `name` (the language's name in that
   language, e.g. `"Français"`) and `intl` (the tag used to format dates and plurals, e.g.
   `"fr-FR"`).
3. Translate the values of every JSON file. **Never change the keys** (the part before
   the colon).
4. Add the language to `index.ts`:

   ```ts
   import fr from "./fr";
   export const LANGUAGES = { en, es, fr };
   ```

   A code with a region goes in quotes: `import ptBR from "./pt-BR";` and
   `{ en, es, "pt-BR": ptBR }`.

5. Run the translation checks: `pnpm test test/i18n.test.ts`. They list anything missing.

The language then appears in the language picker. It is picked automatically for visitors
whose browser asks for it. A message you have not translated yet shows in English, so a
work-in-progress translation never breaks the app. The checks fail until it is complete,
though, so finish it before the pull request is merged.

## The format

- **Placeholders** in braces are filled in by the app: `"Created {date}"`. Keep them
  exactly as they are. You can move them around in the sentence.
- **Tags** mark text that becomes a link or bold: `"Read the <link>privacy policy</link>"`.
  Translate the text between the tags and keep the tags, with the same names.
- **Plurals** are objects with one entry per grammatical form:

  ```json
  "cardCount": { "one": "{count} card", "other": "{count} cards" }
  ```

  Use the forms your language needs (`zero`, `one`, `two`, `few`, `many`, `other`;
  [CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)).
  `other` is always required. The checks tell you if a form is missing.
- Use your language's typography: quotes, apostrophes, `…`, non-breaking spaces before `:`
  in French, and so on.
- Keep the tone short, direct and friendly. Use the informal "you" where your language
  allows it, as the English and Spanish versions do.

## Legal pages

`legal.json` holds the privacy policy, terms of use, cookie policy and legal notice. They
describe what the software does. Translate them faithfully, without adding or removing
obligations. Data about whoever runs an instance (name, contact…) is not translated: it
comes from the instance settings. If you are not sure about a legal term, say so in the
pull request.

## For developers

- Server Components and Server Actions: `const { m, intl } = await getI18n()`
  (`app/i18n/server.ts`). For text written for someone else, such as a notification,
  use `i18nFor(user.locale)`.
- Client Components: `const { m, intl } = useI18n()` (`app/i18n/client.tsx`).
- Helpers in `app/i18n/format.ts`: `fmt(m.x, { name })`, `plural(intl, m.y, count)`.
  For tags, use `rich(m.z, { link: (t) => <Link href="…">{t}</Link> })` from
  `app/i18n/rich.tsx`.
- zod schemas use message **keys** (`"errors.validation.titleRequired"`), turned into
  text with `issueMessage(m, issue)`. Schemas stay language-independent that way.
- Add every new text to `en/` first, then to `es/`. The checks fail if they differ.
- The public REST API (`/api/v1`) answers in English only: it is for programs, not people.
