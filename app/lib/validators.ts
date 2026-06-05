import { z } from "zod";

// Esquemas de validación compartidos (zod). Se usan en las Server Actions para
// validar la entrada antes de tocar la base de datos.

export const loginSchema = z.object({
  email: z.email("Email no válido"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

export const setupSchema = z.object({
  instanceName: z
    .string()
    .trim()
    .min(1, "El nombre de la instancia es obligatorio")
    .max(60, "Máximo 60 caracteres"),
  name: z.string().trim().min(1, "Tu nombre es obligatorio").max(60),
  email: z.email("Email no válido"),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(200),
});

export const boardTitleSchema = z
  .string()
  .trim()
  .min(1, "El título es obligatorio")
  .max(120, "Máximo 120 caracteres");

export const listTitleSchema = z
  .string()
  .trim()
  .min(1, "El título es obligatorio")
  .max(120);

export const cardTitleSchema = z
  .string()
  .trim()
  .min(1, "El título es obligatorio")
  .max(500);

// --- Hito 3: multiusuario ---

// Roles que el propietario puede asignar a un miembro de un tablero (OWNER no se
// asigna desde la UI: es el creador del tablero). Ver app/lib/roles.ts.
export const assignableBoardRoleSchema = z.enum(["EDITOR", "VIEWER"]);

// Invitar a un miembro existente a un tablero por email.
export const addMemberSchema = z.object({
  email: z.email("Email no válido"),
  role: assignableBoardRoleSchema,
});

// Rol global del usuario en la instancia.
export const globalRoleSchema = z.enum(["ADMIN", "MEMBER"]);

// Contraseña reutilizable (mismo criterio que en el setup wizard).
const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(200);

// Alta de usuario por el administrador (no hay registro abierto: el admin crea las
// cuentas). Ver docs/authorization.md.
export const createUserSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(60),
  email: z.email("Email no válido"),
  password: passwordSchema,
  role: globalRoleSchema,
});

// Restablecer la contraseña de un usuario (por el administrador).
export const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  password: passwordSchema,
});
