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

// Tamaño máximo del cuerpo de una petición a una Server Action. Next corta en 1 MB por
// defecto, antes de ejecutar la acción, así que un adjunto de 3 MB fallaba con un error
// genérico en vez de subir. Debe superar al mayor de los límites propios de las acciones:
// MAX_ATTACHMENT_BYTES (10 MB, app/lib/storage.ts) y el import de tableros (5 MB,
// app/lib/actions/boards.ts). El margen de 1 MB cubre la sobrecarga de multipart y deja
// que un archivo algo mayor que 10 MB llegue a la acción y reciba su mensaje propio.
// Es un límite global y Next lo aplica antes de autenticar: cualquiera puede enviar
// 11 MB a una acción. test/next-config.test.ts comprueba que sigue por encima de 10 MB.
const ACTION_BODY_LIMIT_BYTES = 11 * 1024 * 1024;

const nextConfig: NextConfig = {
  // Genera .next/standalone (servidor Node mínimo) para empaquetar la imagen Docker
  // de producción. Se ejecuta con `node server.js`. Ver Dockerfile y docs/docker.md.
  output: "standalone",

  experimental: {
    serverActions: { bodySizeLimit: ACTION_BODY_LIMIT_BYTES },
    // proxy.ts también pasa por las rutas de página (donde llegan las Server Actions) y
    // Next guarda su cuerpo en memoria hasta 10 MB; lo que pase de ahí llega TRUNCADO a
    // la acción, sin error. Por eso va alineado con el límite de las acciones.
    proxyClientMaxBodySize: ACTION_BODY_LIMIT_BYTES,
  },

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
