import { describe, it, expect } from "vitest";
import { firstParam } from "@/app/lib/search-params";

describe("firstParam", () => {
  it("devuelve el string tal cual", () => {
    expect(firstParam("hola")).toBe("hola");
  });

  it("con la clave repetida (?q=a&q=b) devuelve el primer valor", () => {
    expect(firstParam(["a", "b"])).toBe("a");
  });

  it("con un array vacío o sin parámetro devuelve undefined", () => {
    expect(firstParam([])).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
  });
});
