"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { verifySession } from "@/app/lib/dal";
import { LOCALE_COOKIE, isLocale } from "@/app/i18n/config";

// Language picker (footer of the public pages and Settings › Appearance). Works without
// JavaScript: each language is a submit button. The choice goes into a cookie (also for
// visitors without an account) and, when signed in, into User.locale so that
// notifications for this person are written in it.

const ONE_YEAR_S = 365 * 24 * 60 * 60;

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (!isLocale(locale)) return;

  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim();
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_S,
    sameSite: "lax",
    secure: proto === "https",
  });

  const session = await verifySession();
  if (session) {
    await prisma.user.update({ where: { id: session.userId }, data: { locale } });
  }
  revalidatePath("/", "layout");
}
