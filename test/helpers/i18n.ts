import { createElement, type ComponentProps, type ReactNode } from "react";
import { I18nProvider } from "@/app/i18n/client";
import { messagesFor } from "@/app/i18n/config";

// Shared by the unit tests that render Client Components using useI18n(). English is the
// default language, so assertions on visible text are written in English.

const en = messagesFor("en");

/** Wraps a tree in the same provider the root layout uses, with English messages. */
export function withI18n(children: ReactNode) {
  return createElement(
    I18nProvider,
    // `children` goes as the third argument; the props type requires it anyway.
    { locale: "en", intl: "en", messages: en } as ComponentProps<typeof I18nProvider>,
    children,
  );
}
