import { describe, it, expect } from "vitest";
import {
  boardTitleSchema,
  apiCardCreateSchema,
  apiCardUpdateSchema,
  apiTokenNameSchema,
  boardImportSchema,
  labelColorSchema,
} from "@/app/lib/validators";

describe("validators (zod)", () => {
  it("boardTitleSchema recorta y exige 1..120 caracteres", () => {
    expect(boardTitleSchema.parse("  Hola  ")).toBe("Hola");
    expect(boardTitleSchema.safeParse("").success).toBe(false);
    expect(boardTitleSchema.safeParse("   ").success).toBe(false);
    expect(boardTitleSchema.safeParse("x".repeat(121)).success).toBe(false);
  });

  it("apiCardCreateSchema exige título y admite campos opcionales", () => {
    expect(apiCardCreateSchema.safeParse({ title: "Tarea" }).success).toBe(true);
    expect(
      apiCardCreateSchema.safeParse({
        title: "Tarea",
        description: "detalle",
        dueDate: "2026-06-20",
      }).success,
    ).toBe(true);
    expect(apiCardCreateSchema.safeParse({ title: "" }).success).toBe(false);
    expect(apiCardCreateSchema.safeParse({}).success).toBe(false);
  });

  it("apiCardUpdateSchema rechaza un objeto vacío (refine) y acepta campos sueltos", () => {
    expect(apiCardUpdateSchema.safeParse({}).success).toBe(false);
    expect(apiCardUpdateSchema.safeParse({ title: "Nuevo" }).success).toBe(true);
    expect(apiCardUpdateSchema.safeParse({ dueDate: null }).success).toBe(true);
    expect(
      apiCardUpdateSchema.safeParse({ description: null }).success,
    ).toBe(true);
  });

  it("apiTokenNameSchema exige nombre no vacío", () => {
    expect(apiTokenNameSchema.safeParse("Mi token").success).toBe(true);
    expect(apiTokenNameSchema.safeParse("   ").success).toBe(false);
    expect(apiTokenNameSchema.safeParse("x".repeat(61)).success).toBe(false);
  });

  it("labelColorSchema cae a 'blue' fuera de la paleta (también claves del prototipo)", () => {
    expect(labelColorSchema.parse("red")).toBe("red");
    expect(labelColorSchema.parse("constructor")).toBe("blue");
    expect(labelColorSchema.parse("__proto__")).toBe("blue");
    expect(labelColorSchema.parse(undefined)).toBe("blue");
  });

  it("boardImportSchema sanea colores desconocidos en vez de rechazar el fichero", () => {
    const parsed = boardImportSchema.parse({
      board: {
        title: "X",
        background: "constructor",
        labels: [{ name: "Rara", color: "toString" }],
      },
    });
    expect(parsed.board.background).toBeNull();
    expect(parsed.board.labels?.[0].color).toBe("blue");
  });
});
