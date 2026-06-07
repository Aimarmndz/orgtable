import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { GET as listBoards, POST as createBoard } from "@/app/api/v1/boards/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedApiToken,
  apiRequest,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("API v1 — scope y caducidad de tokens (integración)", () => {
  it("un token de solo lectura puede LEER pero no ESCRIBIR (403)", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id, { scope: "read" });

    const read = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(read.status).toBe(200);

    const write = await createBoard(
      apiRequest("POST", "/api/v1/boards", { token, body: { title: "X" } }),
    );
    expect(write.status).toBe(403);
  });

  it("un token con scope completo sí puede escribir", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id, { scope: "full" });
    const res = await createBoard(
      apiRequest("POST", "/api/v1/boards", { token, body: { title: "OK" } }),
    );
    expect(res.status).toBe(201);
  });

  it("un token caducado se rechaza (401)", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id, {
      expiresAt: new Date(Date.now() - 1000), // ya caducó
    });
    const res = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(res.status).toBe(401);
  });
});
