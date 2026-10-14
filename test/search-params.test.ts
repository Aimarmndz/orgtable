import { describe, it, expect } from "vitest";
import { firstParam } from "@/app/lib/search-params";

describe("firstParam", () => {
  it("returns the string as is", () => {
    expect(firstParam("hello")).toBe("hello");
  });

  it("with a repeated key (?q=a&q=b) it returns the first value", () => {
    expect(firstParam(["a", "b"])).toBe("a");
  });

  it("with an empty array or no parameter it returns undefined", () => {
    expect(firstParam([])).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
  });
});
