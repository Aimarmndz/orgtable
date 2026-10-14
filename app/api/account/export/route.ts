import { verifySession } from "@/app/lib/dal";
import { exportUserData } from "@/app/lib/services/account";
import { recordAudit } from "@/app/lib/audit";

// Descarga de los datos personales en JSON (derechos de acceso y portabilidad, arts. 15 y
// 20 RGPD). Qué incluye: services/account.ts (exportUserData). Solo con sesión de
// navegador: los tokens de API no pueden sacar el volcado completo de una cuenta.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await verifySession();
  if (!session) return new Response("No autorizado", { status: 401 });

  const data = await exportUserData(session.userId);
  if (!data) return new Response("No autorizado", { status: 401 });

  await recordAudit({ action: "account.exported", userId: session.userId });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="orgtable-mis-datos-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
