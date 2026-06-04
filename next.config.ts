import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera .next/standalone (servidor Node mínimo) para empaquetar la imagen Docker
  // de producción. Se ejecuta con `node server.js`. Ver Dockerfile y docs/docker.md.
  output: "standalone",
};

export default nextConfig;
