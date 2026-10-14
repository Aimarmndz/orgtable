import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  languageInfo,
  messagesFor,
  negotiateLocale,
  type Locale,
  type Messages,
} from "./config";
import { messageAt } from "./format";

/**
 * Language of the current request: the `locale` cookie (set by the language picker and on
 * sign-in from the account's preference), else the browser's Accept-Language, else English.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return negotiateLocale((await headers()).get("accept-language"));
});

export type I18n = { locale: Locale; intl: string; m: Messages };

/** Language and messages for Server Components and Server Actions. */
export const getI18n = cache(async (): Promise<I18n> => {
  const locale = await getLocale();
  return { locale, intl: languageInfo(locale).intl, m: messagesFor(locale) };
});

/** Messages in a given language, for text generated for someone else (notifications). */
export function i18nFor(locale: string | null | undefined): I18n {
  const l = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { locale: l, intl: languageInfo(l).intl, m: messagesFor(l) };
}

/**
 * Text of a zod issue. Schemas use message keys ("errors.validation.titleRequired"); a
 * message that is not a key (zod's own defaults) falls back to the generic error.
 */
export function issueMessage(m: Messages, issue: { message: string } | undefined): string {
  return (issue && messageAt(m, issue.message)) ?? m.common.genericError;
}
