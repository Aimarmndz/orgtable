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
