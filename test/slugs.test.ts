import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  RESERVED_BOARD_SLUGS,
  RESERVED_WORKSPACE_SLUGS,
  boardPath,
  boardSlugBase,
  firstFreeSlug,
  slugify,
  workspaceSlugBase,
  workspaceSlugProblem,
} from "@/app/lib/slugs";

// URL segments (/<workspace>/<board>): app/lib/slugs.ts and docs/workspaces.md.

describe("slugify", () => {
  it("folds accents, lowercases and collapses everything else into single hyphens", () => {
    expect(slugify("Lanzamiento Página ¡Nueva!", 60)).toBe("lanzamiento-pagina-nueva");
    expect(slugify("  --Ñandú  & Co.-- ", 60)).toBe("nandu-co");
    expect(slugify("¡¡!!", 60)).toBe("");
  });

  it("cuts at the limit without leaving a trailing hyphen", () => {
    expect(slugify("abc def", 4)).toBe("abc");
  });
});

describe("workspaceSlugProblem", () => {
  it("accepts 3-39 lowercase letters, digits and inner single hyphens", () => {
    for (const ok of ["acme", "a1b", "acme-corp", "x".repeat(39)]) {
      expect(workspaceSlugProblem(ok), ok).toBeNull();
    }
  });

  it("refuses bad formats", () => {
    for (const bad of ["ab", "x".repeat(40), "-acme", "acme-", "ac--me", "Acme", "acme corp", "acmé", "a/b"]) {
      expect(workspaceSlugProblem(bad), bad).toBe("format");
    }
  });

  it("refuses the app's own routes and official-sounding words", () => {
    for (const word of ["admin", "api", "boards", "login", "legal", "settings", "setup", "support"]) {
      expect(workspaceSlugProblem(word), word).toBe("reserved");
    }
  });

  // Every top-level route of the app must be reserved, or a workspace could shadow it.
  it("reserves every top-level route of the app", () => {
    for (const route of ["admin", "api", "board", "boards", "legal", "login", "register", "search", "settings", "setup"]) {
      expect(RESERVED_WORKSPACE_SLUGS.has(route), route).toBe(true);
    }
  });

  // The migration that introduced workspaces applies the same list in SQL.
  it("the migration reserves the same words", () => {
    const sql = readFileSync("prisma/migrations/20261015000000_workspaces/migration.sql", "utf8");
    const list = (name: string) =>
      [...sql.match(new RegExp(`${name} TEXT\\[\\] := ARRAY\\[([^\\]]*)\\]`))![1].matchAll(/'([^']+)'/g)].map(
        (m) => m[1],
      );
    expect(new Set(list("reserved_ws"))).toEqual(RESERVED_WORKSPACE_SLUGS);
    expect(new Set(list("reserved_board"))).toEqual(RESERVED_BOARD_SLUGS);
  });
});

describe("bases and free slugs", () => {
  it("always produce a valid base", () => {
    expect(workspaceSlugBase("aimar")).toBe("aimar");
    expect(workspaceSlugBase("a")).toBe("a-user");
    expect(workspaceSlugBase("!!")).toBe("user");
    expect(boardSlugBase("¡¡!!")).toBe("board");
    expect(workspaceSlugProblem(workspaceSlugBase("José.Núñez+tag"))).toBeNull();
  });

  it("firstFreeSlug skips taken and reserved candidates", async () => {
    const taken = new Set(["roadmap", "roadmap-2"]);
    expect(await firstFreeSlug("roadmap", new Set(), async (s) => taken.has(s))).toBe("roadmap-3");
    expect(await firstFreeSlug("settings", RESERVED_BOARD_SLUGS, async () => false)).toBe("settings-2");
  });

  it("boardPath joins both segments", () => {
    expect(boardPath("acme", "roadmap")).toBe("/acme/roadmap");
  });
});
