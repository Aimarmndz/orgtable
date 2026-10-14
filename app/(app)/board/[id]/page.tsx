import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { findBoardByPath, getBoardTitleForUser } from "@/app/lib/queries";
import { boardPath } from "@/app/lib/slugs";

// Old board address (before workspaces) and the one notifications and search still link
// to: /board/<id> redirects to /<workspace>/<board>, keeping the query string (?card=…).
// Only for boards the user can open; any other id gives the same 404.
export default async function LegacyBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const found = await findBoardByPath("", id);
  if (!found || !(await getBoardTitleForUser(found.id, user.id))) notFound();
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") query.set(k, v);
  }
  const qs = query.toString();
  redirect(`${boardPath(found.workspace.slug, found.slug)}${qs ? `?${qs}` : ""}`);
}
