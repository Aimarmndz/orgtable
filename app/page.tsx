import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { publicHost } from "@/app/lib/mail/config";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import {
  installScriptUrl,
  landingMode,
  shouldShowLanding,
} from "@/app/lib/landing";
import { sourceCodeUrl } from "@/app/lib/site";
import { getI18n } from "@/app/i18n/server";
import { LandingPage } from "@/app/components/landing/landing-page";

// Depends on the database and the session, so it must never be prerendered at build
// time (the Docker build has no database either).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.landing.metaTitle };
}

// Entry point: sends the visitor where they belong given the instance state and the
// session. Without a session it shows the public landing when ORGTABLE_LANDING allows it
// (by default, only while sign-up is open), and the sign-in screen otherwise.
export default async function Home() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");
  const registrationOpen = await isRegistrationOpen();
  if (!shouldShowLanding(landingMode(), registrationOpen)) redirect("/login");
  return (
    <LandingPage
      registrationOpen={registrationOpen}
      host={publicHost((await headers()).get("host"))}
      installScriptUrl={installScriptUrl()}
      sourceUrl={sourceCodeUrl()}
    />
  );
}
