import "server-only";
import bcrypt from "bcryptjs";

// Hashing de contraseñas con bcryptjs (puro JS, sin compilación nativa: cero
// fricción en la imagen Alpine). Ver docs/authentication.md.

export const SALT_ROUNDS = 12;

// Hash bcrypt REAL (60 caracteres, coste SALT_ROUNDS) de un UUID aleatorio que no se
// guardó: ninguna contraseña coincide con él. Sirve para gastar el mismo tiempo cuando el
// email no existe. Tiene que ser un hash válido: con un literal mal formado (el anterior
// medía 59) bcrypt.compare devuelve false al instante y el tiempo de respuesta delata si
// una cuenta existe. Es un literal para no pagar un hashSync al importar el módulo.
export const DUMMY_PASSWORD_HASH =
  "$2b$12$llgSC9FXycV4gh6.tWFq..r2hz9NXMksFmfWuDrIuN7lf.C.qa5pq";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Verifica la contraseña contra `hash` o, si no hay cuenta (`null`), contra el hash
 * ficticio, que siempre da false tras el mismo trabajo de bcrypt. Así el login tarda lo
 * mismo exista o no el email.
 */
export async function verifyPasswordOrDummy(
  password: string,
  hash: string | null,
): Promise<boolean> {
  const valid = await verifyPassword(password, hash ?? DUMMY_PASSWORD_HASH);
  return hash !== null && valid;
}
