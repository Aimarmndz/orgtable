import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";
import { MAX_ATTACHMENT_BYTES } from "@/app/lib/storage";

// Holgura mínima para la sobrecarga de multipart (límites, cabeceras de cada parte y
// campos del formulario). La guía de Next recomienda 10–20 KB; se exige más.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Cabeceras que next.config.ts aplica a una ruta concreta, fusionadas por orden. */
async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const result = new Map<string, string>();
  for (const rule of rules) {
    // Las reglas usan `/:path*` y `/api/:path*`: basta con comparar el prefijo.
    const prefix = rule.source.replace("/:path*", "");
    if (prefix === "" || path === prefix || path.startsWith(`${prefix}/`)) {
      for (const { key, value } of rule.headers) result.set(key, value);
    }
  }
  return result;
}

describe("límite del cuerpo de las Server Actions", () => {
  // Con el valor por defecto de Next (1 MB) cualquier adjunto de más de 1 MB fallaba
  // antes de llegar a uploadAttachment.
  it("deja pasar un adjunto del tamaño máximo con su sobrecarga multipart", () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
    expect(typeof limit).toBe("number");
    expect(limit).toBeGreaterThan(MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES);
  });

  // proxy.ts pasa por las rutas de página: si guarda menos que eso, el cuerpo llega
  // truncado a la acción sin ningún error.
  it("proxy guarda en memoria el cuerpo completo de esas peticiones", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(
      nextConfig.experimental?.serverActions?.bodySizeLimit,
    );
  });
});

describe("cabeceras de seguridad (next.config.ts)", () => {
  it.each(["/", "/login", "/api/v1/boards"])("%s lleva las cabeceras fijas", async (path) => {
    const h = await headersFor(path);
    expect(h.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("/api/v1 recibe una CSP cerrada (solo JSON, SSE y descargas)", async () => {
    const h = await headersFor("/api/v1/boards");
    expect(h.get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it("las páginas no reciben la CSP estática: la pone proxy.ts con nonce", async () => {
    expect((await headersFor("/login")).has("Content-Security-Policy")).toBe(false);
  });
});
