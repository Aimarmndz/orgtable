import { verifySession } from "@/app/lib/dal";
import { exportUserData } from "@/app/lib/services/account";
import { recordAudit } from "@/app/lib/audit";

// Download of the user's personal data as JSON (rights of access and portability, GDPR
// arts. 15 and 20). What it contains: services/account.ts (exportUserData). Browser
// session only: API tokens cannot pull the full dump of an account.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await verifySession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const data = await exportUserData(session.userId);
  if (!data) return new Response("Unauthorized", { status: 401 });

  await recordAudit({ action: "account.exported", userId: session.userId });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="orgtable-my-data-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
