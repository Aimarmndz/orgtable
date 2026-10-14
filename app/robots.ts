import type { MetadataRoute } from "next";
import { isRegistrationOpen } from "@/app/lib/services/instance";

// A private instance (sign-up closed) has nothing to index, so search engines are asked to
// stay out. With open sign-up only the public pages are allowed (sign-in, sign-up and
// legal pages); boards require a session anyway.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!(await isRegistrationOpen())) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: ["/login", "/register", "/legal/"],
      disallow: "/",
    },
  };
}
