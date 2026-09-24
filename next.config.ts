import type { NextConfig } from "next";

// Cabeceras de seguridad aplicadas a todas las respuestas. La CSP de las páginas lleva un
// nonce por petición y la pone proxy.ts (app/lib/csp.ts); aquí van las cabeceras fijas y
// una CSP cerrada para /api, que solo sirve JSON, SSE y descargas. Ver docs/security.md.
const securityHeaders = [
  // Anti-clickjacking: la app no se embebe en iframes.
  { key: "X-Frame-Options", value: "DENY" },
  // Evita el MIME-sniffing (refuerza la descarga forzada de adjuntos).
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HSTS: el navegador solo lo respeta si la respuesta llega por HTTPS, así que no
  // afecta a instalaciones por http://IP:3000. Sin includeSubDomains: orgtable suele
  // vivir en un subdominio de alguien y no debe imponer HTTPS a sus hermanos.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // Genera .next/standalone (servidor Node mínimo) para empaquetar la imagen Docker
  // de producción. Se ejecuta con `node server.js`. Ver Dockerfile y docs/docker.md.
  output: "standalone",

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
