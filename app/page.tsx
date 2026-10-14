import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";

// Depends on the database and the session, so it must never be prerendered at build
// time (the Docker build has no database either).
export const dynamic = "force-dynamic";

// Entry point: sends the visitor where they belong given the instance state and the
// session.
export default async function Home() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (!(await verifySession())) redirect("/login");
  redirect("/boards");
}
