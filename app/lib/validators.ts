import { z } from "zod";
import { BOARD_COLOR_KEYS, LABEL_COLOR_KEYS } from "@/app/lib/colors";

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

// Colores de etiqueta y de fondo de tablero. Se validan contra la paleta con z.enum (no con
// el operador `in`, que acepta claves del prototipo como 'constructor'). `.catch` mantiene
// la tolerancia de antes: un color desconocido cae al valor por defecto en vez de fallar.
export const labelColorSchema = z.enum(LABEL_COLOR_KEYS).catch("blue");
const boardBackgroundSchema = z.enum(BOARD_COLOR_KEYS).nullable().catch(null);

// Hito 10: comentarios de tarjeta.
export const commentTextSchema = z
  .string()
  .trim()
  .min(1, "El comentario no puede estar vacío")
  .max(2000, "Máximo 2000 caracteres");

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

// --- Hito 5: importación de tableros (JSON) ---
// Esquema del fichero que produce GET /api/boards/[id]/export. Tolerante con el sobre
// `orgtable` (opcional) pero estricto con la forma y los límites de tamaño.

const importChecklistItemSchema = z.object({
  text: z.string().max(200),
  done: z.boolean(),
});

const importChecklistSchema = z.object({
  title: z.string().max(80),
  items: z.array(importChecklistItemSchema).max(200).optional(),
});

const importCardSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  dueDate: z.string().max(40).nullable().optional(),
  labels: z.array(z.string().max(40)).max(50).optional(),
  checklists: z.array(importChecklistSchema).max(50).optional(),
});

const importListSchema = z.object({
  title: z.string().min(1).max(120),
  cards: z.array(importCardSchema).max(500).optional(),
});

const importLabelSchema = z.object({
  name: z.string().min(1).max(40),
  color: labelColorSchema,
});

export const boardImportSchema = z.object({
  orgtable: z
    .object({ type: z.string().optional(), version: z.number().optional() })
    .optional(),
  board: z.object({
    title: z.string().min(1).max(120),
    background: boardBackgroundSchema.optional(),
    labels: z.array(importLabelSchema).max(50).optional(),
    lists: z.array(importListSchema).max(50).optional(),
  }),
});

// --- Hito 9: API pública ---
// Cuerpos JSON de las peticiones de la API. Reutilizan los mismos límites que las
// Server Actions (cardTitleSchema, etc.). Ver docs/api/public-api.md.

export const apiTokenNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio")
  .max(60, "Máximo 60 caracteres");

// Alcance del token: "full" (lectura+escritura) o "read" (solo lectura). Hito 13.
export const apiTokenScopeSchema = z.enum(["full", "read"]);

// Caducidad elegida en /settings: nunca o un número de días.
export const apiTokenExpirySchema = z.enum(["0", "30", "90", "365"]);

export const apiCardCreateSchema = z.object({
  title: cardTitleSchema,
  description: z.string().max(5000).nullish(),
  dueDate: z.string().max(40).nullish(),
});

export const apiCardUpdateSchema = z
  .object({
    title: cardTitleSchema.optional(),
    description: z.string().max(5000).nullable().optional(),
    dueDate: z.string().max(40).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "No hay campos que actualizar.",
  });
