// Endpoint de health check usado por el healthcheck de docker-compose para saber
// cuándo el contenedor `app` está listo. No toca la base de datos a propósito:
// solo confirma que el servidor Next responde.
export async function GET() {
  return Response.json({ status: "ok" });
}
