import { describe, it, expect } from "vitest";
import {
  boardTitleSchema,
  apiCardCreateSchema,
  apiCardUpdateSchema,
  apiTokenNameSchema,
  addMemberSchema,
  assignableBoardRoleSchema,
  commentTextSchema,
  boardImportSchema,
  setupSchema,
  createUserSchema,
  resetPasswordSchema,
  cardDetailsSchema,
  dueDateSchema,
  labelColorSchema,
} from "@/app/lib/validators";
import { ASSIGNABLE_BOARD_ROLES } from "@/app/lib/roles";

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

  it("apiCardCreateSchema/apiCardUpdateSchema validan el formato de dueDate", () => {
    for (const ok of ["2026-07-01", "2026-07-01T10:00:00Z", "2026-07-01T10:00:00+02:00"]) {
      expect(apiCardUpdateSchema.safeParse({ dueDate: ok }).success).toBe(true);
      expect(apiCardCreateSchema.safeParse({ title: "T", dueDate: ok }).success).toBe(true);
    }
    for (const bad of ["", "31/12/2026", "2026-02-31", "2026-07-01T10:00:00"]) {
      expect(apiCardUpdateSchema.safeParse({ dueDate: bad }).success).toBe(false);
      expect(apiCardCreateSchema.safeParse({ title: "T", dueDate: bad }).success).toBe(false);
    }
    expect(apiCardCreateSchema.safeParse({ title: "T", dueDate: null }).success).toBe(true);
  });

  it("dueDateSchema y cardDetailsSchema (modal de tarjeta)", () => {
    expect(dueDateSchema.safeParse("").success).toBe(true);
    expect(dueDateSchema.safeParse(null).success).toBe(true);
    expect(dueDateSchema.safeParse("2026-09-24").success).toBe(true);
    expect(dueDateSchema.safeParse("24/09/2026").success).toBe(false);
    expect(dueDateSchema.safeParse("2026-02-31").success).toBe(false);
    expect(
      cardDetailsSchema.safeParse({ description: "x".repeat(5000), dueDate: "" }).success,
    ).toBe(true);
    expect(
      cardDetailsSchema.safeParse({ description: "x".repeat(5001), dueDate: "" }).success,
    ).toBe(false);
  });

  it("labelColorSchema cae a 'blue' fuera de la paleta (también claves del prototipo)", () => {
    expect(labelColorSchema.parse("red")).toBe("red");
    expect(labelColorSchema.parse("constructor")).toBe("blue");
    expect(labelColorSchema.parse("__proto__")).toBe("blue");
    expect(labelColorSchema.parse(undefined)).toBe("blue");
  });

  it("addMemberSchema y assignableBoardRoleSchema no permiten asignar OWNER", () => {
    expect(assignableBoardRoleSchema.safeParse("OWNER").success).toBe(false);
    expect(assignableBoardRoleSchema.safeParse("EDITOR").success).toBe(true);
    expect(addMemberSchema.safeParse({ email: "a@b.es", role: "OWNER" }).success).toBe(false);
    expect(addMemberSchema.safeParse({ email: "a@b.es", role: "EDITOR" }).success).toBe(true);
    // El esquema y la lista de la UI no deben divergir.
    expect([...assignableBoardRoleSchema.options].sort()).toEqual(
      [...ASSIGNABLE_BOARD_ROLES].sort(),
    );
  });

  it("commentTextSchema recorta y exige 1..2000 caracteres", () => {
    expect(commentTextSchema.safeParse("   ").success).toBe(false);
    expect(commentTextSchema.safeParse("x".repeat(2001)).success).toBe(false);
    expect(commentTextSchema.parse("  hola  ")).toBe("hola");
  });

  it("boardImportSchema acepta el formato del export y rechaza lo que se sale de él", () => {
    expect(boardImportSchema.safeParse({ board: { title: "Mínimo" } }).success).toBe(true);
    const full = {
      orgtable: { type: "board", version: 1 },
      board: {
        title: "Completo",
        background: "teal",
        labels: [{ name: "Urgente", color: "red" }],
        lists: [
          {
            title: "Pendiente",
            cards: [
              {
                title: "Tarea",
                description: "Detalle",
                dueDate: "2026-07-01T00:00:00.000Z",
                labels: ["Urgente"],
                checklists: [{ title: "Pasos", items: [{ text: "Uno", done: false }] }],
              },
            ],
          },
        ],
      },
    };
    expect(boardImportSchema.safeParse(full).success).toBe(true);

    const lists51 = Array.from({ length: 51 }, (_, i) => ({ title: `L${i}` }));
    expect(
      boardImportSchema.safeParse({ board: { title: "X", lists: lists51 } }).success,
    ).toBe(false);
    expect(boardImportSchema.safeParse({ board: { title: "" } }).success).toBe(false);
    expect(
      boardImportSchema.safeParse({
        board: { title: "X", lists: [{ title: "L", cards: [{ title: "" }] }] },
      }).success,
    ).toBe(false);
    expect(
      boardImportSchema.safeParse({
        board: {
          title: "X",
          lists: [
            {
              title: "L",
              cards: [{ title: "T", checklists: [{ title: "C", items: [{ text: "i", done: "yes" }] }] }],
            },
          ],
        },
      }).success,
    ).toBe(false);
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

  it("setupSchema y createUserSchema: longitud de contraseña y rol", () => {
    const user = { name: "Ana", email: "ana@example.com", role: "MEMBER" };
    const setup = { instanceName: "Equipo", name: "Ana", email: "ana@example.com" };
    for (const [password, ok] of [
      ["x".repeat(7), false],
      ["x".repeat(8), true],
      ["x".repeat(201), false],
    ] as const) {
      expect(createUserSchema.safeParse({ ...user, password }).success).toBe(ok);
      expect(setupSchema.safeParse({ ...setup, password }).success).toBe(ok);
    }
    expect(
      createUserSchema.safeParse({ ...user, password: "x".repeat(8), role: "SUPERADMIN" })
        .success,
    ).toBe(false);
  });

  // bcrypt solo usa los primeros 72 bytes: por encima, dos contraseñas con el mismo prefijo
  // serían equivalentes.
  it("la contraseña no puede pasar de 72 bytes UTF-8", () => {
    const check = (password: string) =>
      resetPasswordSchema.safeParse({ userId: "u1", password }).success;
    expect(check("a".repeat(72))).toBe(true);
    expect(check("a".repeat(73))).toBe(false);
    expect(check("ñ".repeat(36))).toBe(true);
    expect(check("ñ".repeat(37))).toBe(false);
    const setup = { instanceName: "Equipo", name: "Ana", email: "ana@example.com" };
    expect(setupSchema.safeParse({ ...setup, password: "a".repeat(73) }).success).toBe(false);
  });
});
