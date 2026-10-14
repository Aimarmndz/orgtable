"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { verifySession } from "@/app/lib/dal";
import { isLocale } from "@/app/i18n/config";
import { setLocaleCookie } from "@/app/i18n/cookie";

// Language picker (footer of the public pages and Settings › Appearance). Works without
// JavaScript: each language is a submit button. The choice goes into a cookie (also for
// visitors without an account) and, when signed in, into User.locale so that
// notifications for this person are written in it.

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (!isLocale(locale)) return;

  await setLocaleCookie(locale);

  const session = await verifySession();
  if (session) {
    await prisma.user.update({ where: { id: session.userId }, data: { locale } });
  }
  revalidatePath("/", "layout");
}
