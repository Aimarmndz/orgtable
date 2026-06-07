import { describe, it, expect } from "vitest";
import { hashToken, generateApiToken } from "@/app/lib/api/tokens";

// Tokens de la API pública (Hito 9, ADR 0013). Invariantes: el hash es SHA-256 estable,
// el token lleva el prefijo `orgt_`, su hash coincide y nunca se repite.
describe("api tokens", () => {
  it("hashToken es determinista y SHA-256 en hex (64 chars)", () => {
    const h = hashToken("orgt_ejemplo");
    expect(h).toBe(hashToken("orgt_ejemplo"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("otro")).not.toBe(h);
  });

  it("generateApiToken: prefijo orgt_, hash coherente y prefijo visible de 12", () => {
    const t = generateApiToken();
    expect(t.token.startsWith("orgt_")).toBe(true);
    expect(t.hash).toBe(hashToken(t.token));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.token.startsWith(t.prefix)).toBe(true);
    expect(t.prefix.length).toBe(12); // "orgt_" (5) + 7 caracteres
  });

  it("dos tokens consecutivos son distintos", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});
