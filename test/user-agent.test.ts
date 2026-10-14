import { describe, it, expect } from "vitest";
import { describeUserAgent } from "@/app/lib/user-agent";

describe("describeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox en macOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      "Chrome en Android",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
      "Edge en Windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
      "Safari en iOS",
    ],
    ["curl/8.7.1", "Navegador desconocido"],
  ])("%s → %s", (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });

  it("sin user-agent", () => {
    expect(describeUserAgent(null)).toBe("Navegador desconocido");
  });
});
