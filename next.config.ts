import type { NextConfig } from "next";

// Cabeceras de seguridad aplicadas a todas las respuestas. No incluimos una CSP estricta
// (Next inyecta scripts/estilos inline; una CSP con nonce es un trabajo aparte, anotado en
// docs/security.md), pero sí los controles de bajo riesgo y alto valor. Ver docs/security.md.
const securityHeaders = [
  // Anti-clickjacking: la app no se embebe en iframes.
  { key: "X-Frame-Options", value: "DENY" },
  // Evita el MIME-sniffing (refuerza la descarga forzada de adjuntos).
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  // Genera .next/standalone (servidor Node mínimo) para empaquetar la imagen Docker
  // de producción. Se ejecuta con `node server.js`. Ver Dockerfile y docs/docker.md.
  output: "standalone",

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
