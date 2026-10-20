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
  it("boardTitleSchema trims and requires 1..120 characters", () => {
    expect(boardTitleSchema.parse("  Hello  ")).toBe("Hello");
    expect(boardTitleSchema.safeParse("").success).toBe(false);
    expect(boardTitleSchema.safeParse("   ").success).toBe(false);
    expect(boardTitleSchema.safeParse("x".repeat(121)).success).toBe(false);
  });

  it("apiCardCreateSchema requires a title and accepts optional fields", () => {
    expect(apiCardCreateSchema.safeParse({ title: "Task" }).success).toBe(true);
    expect(
      apiCardCreateSchema.safeParse({
        title: "Task",
        description: "details",
        dueDate: "2026-06-20",
      }).success,
    ).toBe(true);
    expect(apiCardCreateSchema.safeParse({ title: "" }).success).toBe(false);
    expect(apiCardCreateSchema.safeParse({}).success).toBe(false);
  });

  it("apiCardUpdateSchema rejects an empty object (refine) and accepts single fields", () => {
    expect(apiCardUpdateSchema.safeParse({}).success).toBe(false);
    expect(apiCardUpdateSchema.safeParse({ title: "New" }).success).toBe(true);
    expect(apiCardUpdateSchema.safeParse({ dueDate: null }).success).toBe(true);
    expect(
      apiCardUpdateSchema.safeParse({ description: null }).success,
    ).toBe(true);
  });

  it("apiTokenNameSchema requires a non-empty name", () => {
    expect(apiTokenNameSchema.safeParse("My token").success).toBe(true);
    expect(apiTokenNameSchema.safeParse("   ").success).toBe(false);
    expect(apiTokenNameSchema.safeParse("x".repeat(61)).success).toBe(false);
  });

  it("apiCardCreateSchema/apiCardUpdateSchema validate the dueDate format", () => {
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

  it("dueDateSchema and cardDetailsSchema (card modal)", () => {
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

  it("labelColorSchema falls back to 'blue' outside the palette (prototype keys too)", () => {
    expect(labelColorSchema.parse("red")).toBe("red");
    expect(labelColorSchema.parse("constructor")).toBe("blue");
    expect(labelColorSchema.parse("__proto__")).toBe("blue");
    expect(labelColorSchema.parse(undefined)).toBe("blue");
  });

  it("labelColorSchema keeps a free #rrggbb colour, lower-cased, and nothing looser", () => {
    expect(labelColorSchema.parse("#F54927")).toBe("#f54927");
    expect(labelColorSchema.parse("#f54")).toBe("blue");
    expect(labelColorSchema.parse("#f54927;x")).toBe("blue");
  });

  it("addMemberSchema and assignableBoardRoleSchema do not allow assigning OWNER", () => {
    expect(assignableBoardRoleSchema.safeParse("OWNER").success).toBe(false);
    expect(assignableBoardRoleSchema.safeParse("EDITOR").success).toBe(true);
    expect(addMemberSchema.safeParse({ email: "a@b.es", role: "OWNER" }).success).toBe(false);
    expect(addMemberSchema.safeParse({ email: "a@b.es", role: "EDITOR" }).success).toBe(true);
    // The schema and the UI list must not diverge.
    expect([...assignableBoardRoleSchema.options].sort()).toEqual(
      [...ASSIGNABLE_BOARD_ROLES].sort(),
    );
  });

  it("commentTextSchema trims and requires 1..2000 characters", () => {
    expect(commentTextSchema.safeParse("   ").success).toBe(false);
    expect(commentTextSchema.safeParse("x".repeat(2001)).success).toBe(false);
    expect(commentTextSchema.parse("  hello  ")).toBe("hello");
  });

  it("boardImportSchema accepts the export format and rejects whatever falls outside it", () => {
    expect(boardImportSchema.safeParse({ board: { title: "Minimal" } }).success).toBe(true);
    const full = {
      orgtable: { type: "board", version: 1 },
      board: {
        title: "Complete",
        background: "teal",
        labels: [{ name: "Urgent", color: "red" }],
        lists: [
          {
            title: "To do",
            cards: [
              {
                title: "Task",
                description: "Details",
                dueDate: "2026-07-01T00:00:00.000Z",
                labels: ["Urgent"],
                checklists: [{ title: "Steps", items: [{ text: "One", done: false }] }],
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

  it("boardImportSchema sanitises unknown colours instead of rejecting the file", () => {
    const parsed = boardImportSchema.parse({
      board: {
        title: "X",
        background: "constructor",
        labels: [{ name: "Odd", color: "toString" }],
      },
    });
    expect(parsed.board.background).toBeNull();
    expect(parsed.board.labels?.[0].color).toBe("blue");
  });

  it("setupSchema and createUserSchema: password length and role", () => {
    const user = { name: "Ana", email: "ana@example.com", role: "MEMBER" };
    const setup = { instanceName: "Team", name: "Ana", email: "ana@example.com" };
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

  // bcrypt only uses the first 72 bytes: beyond that, two passwords with the same prefix
  // would be equivalent.
  it("the password cannot exceed 72 UTF-8 bytes", () => {
    const check = (password: string) =>
      resetPasswordSchema.safeParse({ userId: "u1", password }).success;
    expect(check("a".repeat(72))).toBe(true);
    expect(check("a".repeat(73))).toBe(false);
    expect(check("ñ".repeat(36))).toBe(true);
    expect(check("ñ".repeat(37))).toBe(false);
    const setup = { instanceName: "Team", name: "Ana", email: "ana@example.com" };
    expect(setupSchema.safeParse({ ...setup, password: "a".repeat(73) }).success).toBe(false);
  });
});
