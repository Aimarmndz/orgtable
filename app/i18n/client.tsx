"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Messages } from "./config";

// Messages for Client Components. The layout (a Server Component) resolves the language
// and passes the dictionary down as plain data; nothing here imports the dictionaries, so
// the client bundle only carries the language in use.

type ClientI18n = { locale: string; intl: string; m: Messages };

const I18nContext = createContext<ClientI18n | null>(null);

export function I18nProvider({
  locale,
  intl,
  messages,
  children,
}: {
  locale: string;
  intl: string;
  messages: Messages;
  children: ReactNode;
}) {
  return (
    <I18nContext.Provider value={{ locale, intl, m: messages }}>{children}</I18nContext.Provider>
  );
}

/** Current language and messages. Must be used inside I18nProvider. */
export function useI18n(): ClientI18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n() needs an <I18nProvider> above it");
  return value;
}
