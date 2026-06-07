import "server-only";
import { randomBytes, createHash } from "node:crypto";

// Generación y hash de tokens de acceso personal (Hito 9). El token se entrega al
// usuario UNA vez; en la base de datos solo vive su hash SHA-256. Ver
// docs/decisions/0013-api-tokens.md.

const PREFIX = "orgt_";

export type GeneratedToken = {
  /** Token completo en claro. Solo se muestra una vez; nunca se persiste. */
  token: string;
  /** Hash SHA-256 (hex) que sí se guarda y por el que se busca al autenticar. */
  hash: string;
  /** Primeros caracteres, para que el usuario identifique el token en la lista. */
  prefix: string;
};

/** SHA-256 en hexadecimal de un token. Determinista: misma entrada → mismo hash. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Crea un token nuevo: 24 bytes aleatorios en base64url con el prefijo `orgt_`. */
export function generateApiToken(): GeneratedToken {
  const token = PREFIX + randomBytes(24).toString("base64url");
  return {
    token,
    hash: hashToken(token),
    // Prefijo visible (p. ej. "orgt_Ab3kQ9x"): suficiente para reconocerlo sin revelarlo.
    prefix: token.slice(0, PREFIX.length + 7),
  };
}
