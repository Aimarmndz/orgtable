"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { settingsPathForFragment } from "@/app/lib/settings-paths";

// /settings used to be one long page with fragments (/settings#data). The fragment never
// reaches the server, so the browser picks the page it meant (the profile by default).
export function LegacySettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(settingsPathForFragment(window.location.hash));
  }, [router]);
  return null;
}
