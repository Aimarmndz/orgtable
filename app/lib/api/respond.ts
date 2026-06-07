import "server-only";

// Respuestas JSON uniformes para la API pública (Hito 9). Los errores siempre tienen la
// forma `{ "error": "mensaje" }`; los datos van tal cual. Ver docs/api/public-api.md.

export function apiError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export function apiOk(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}
