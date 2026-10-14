import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { GET as listBoards, POST as createBoard } from "@/app/api/v1/boards/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedApiToken,
  seedBoard,
  apiRequest,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("API v1 — boards (integration)", () => {
  it("401 without a token", async () => {
    const res = await listBoards(apiRequest("GET", "/api/v1/boards"));
    expect(res.status).toBe(401);
  });

  it("401 with a token that does not exist", async () => {
    const res = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token: "orgt_missing" }),
    );
    expect(res.status).toBe(401);
  });

  it("POST creates a board and makes the user its OWNER", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id);

    const res = await createBoard(
      apiRequest("POST", "/api/v1/boards", {
        token,
        body: { title: "My board" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("My board");

    const member = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: body.id, userId: user.id } },
    });
    expect(member?.role).toBe("OWNER");
  });

  it("POST with an empty title → 422 (validation)", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id);
    const res = await createBoard(
      apiRequest("POST", "/api/v1/boards", { token, body: { title: "" } }),
    );
    expect(res.status).toBe(422);
  });

  it("GET only returns the boards the token's user can access", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const tokenA = await seedApiToken(a.id);
    await seedBoard(a.id, "A's");
    await seedBoard(b.id, "B's (not theirs)");

    const res = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token: tokenA }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.boards.map((x: { title: string }) => x.title)).toEqual([
      "A's",
    ]);
  });
});
