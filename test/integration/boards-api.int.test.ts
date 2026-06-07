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

describe("API v1 — tableros (integración)", () => {
  it("401 sin token", async () => {
    const res = await listBoards(apiRequest("GET", "/api/v1/boards"));
    expect(res.status).toBe(401);
  });

  it("401 con un token inexistente", async () => {
    const res = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token: "orgt_inexistente" }),
    );
    expect(res.status).toBe(401);
  });

  it("POST crea un tablero y deja al usuario como OWNER", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id);

    const res = await createBoard(
      apiRequest("POST", "/api/v1/boards", {
        token,
        body: { title: "Mi tablero" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Mi tablero");

    const member = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: body.id, userId: user.id } },
    });
    expect(member?.role).toBe("OWNER");
  });

  it("POST con título vacío → 422 (validación)", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id);
    const res = await createBoard(
      apiRequest("POST", "/api/v1/boards", { token, body: { title: "" } }),
    );
    expect(res.status).toBe(422);
  });

  it("GET solo devuelve los tableros accesibles por el usuario del token", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const tokenA = await seedApiToken(a.id);
    await seedBoard(a.id, "De A");
    await seedBoard(b.id, "De B (ajeno)");

    const res = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token: tokenA }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.boards.map((x: { title: string }) => x.title)).toEqual([
      "De A",
    ]);
  });
});
