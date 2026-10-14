// Health check endpoint used by the docker-compose healthcheck to know when the `app`
// container is ready. It deliberately does not touch the database: it only confirms
// that the Next server responds.
export async function GET() {
  return Response.json({ status: "ok" });
}
