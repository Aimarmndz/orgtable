// Content-Security-Policy de las páginas HTML. La genera proxy.ts en cada petición con
// un nonce nuevo; Next lee el nonce de la cabecera y lo aplica a sus propios scripts
// (ver node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
//
// Decisiones (docs/DECISIONES.md, 2026-09-24):
// - Sin `upgrade-insecure-requests`: orgtable se instala a menudo por http://IP:3000;
//   esa directiva pasaría todos los recursos a https y la app no cargaría.
// - `style-src-attr 'unsafe-inline'`: React pinta atributos `style` en el HTML del
//   servidor (color de fondo del tablero, transformaciones de dnd-kit) y un nonce no
//   cubre atributos. Los elementos <style>/<link> sí exigen nonce o mismo origen.
// - Solo en desarrollo: `'unsafe-eval'` (React reconstruye trazas de error con eval) y
//   estilos inline sin nonce (Turbopack y el overlay de errores inyectan <style> sin
//   él). Si hay nonce, el navegador ignora 'unsafe-inline', por eso se quita el nonce.
//   El build de producción no genera ninguna violación (verificado con Playwright).

export function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const styleSources = isDev ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src ${styleSources}`,
    `style-src-elem ${styleSources}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

/** Nonce aleatorio de 128 bits en base64, uno por petición. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
