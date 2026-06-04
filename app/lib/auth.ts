import "server-only";
import bcrypt from "bcryptjs";

// Hashing de contraseñas con bcryptjs (puro JS, sin compilación nativa: cero
// fricción en la imagen Alpine). Ver docs/authentication.md.

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
