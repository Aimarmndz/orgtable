import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseTrustedProxyHops,
  pickClientIp,
  resolveClientIp,
} from "@/app/lib/client-ip";

// Client IP for the sign-in rate limit: X-Forwarded-For is only trusted if trusted proxies
// are declared, and the value taken is the one added by the outermost one (counting from
// the right). The first value is written by the client and is worthless.
describe("pickClientIp", () => {
  it("with hops = 0 it ignores the header", () => {
    expect(pickClientIp("1.2.3.4", 0)).toBeNull();
  });

  it("without a header or with an empty one it returns null", () => {
    expect(pickClientIp(null, 1)).toBeNull();
    expect(pickClientIp("", 1)).toBeNull();
  });

  it("takes the Nth value from the right", () => {
    expect(pickClientIp("1.2.3.4, 10.0.0.1", 1)).toBe("10.0.0.1");
    expect(pickClientIp("1.2.3.4, 10.0.0.1", 2)).toBe("1.2.3.4");
  });

  it("with fewer values than declared proxies it returns null", () => {
    expect(pickClientIp("10.0.0.1", 2)).toBeNull();
  });

  it("trims spaces and accepts IPv6", () => {
    expect(pickClientIp("  1.2.3.4  ", 1)).toBe("1.2.3.4");
    expect(pickClientIp("fake, 2001:db8::1", 1)).toBe("2001:db8::1");
  });

  it("a value that is not an IP returns null", () => {
    expect(pickClientIp("1.2.3.4, unknown", 1)).toBeNull();
    expect(pickClientIp("1.2.3.4, ", 1)).toBeNull();
  });

  // Regression: with proxies that write the IP with the source port (Azure Application
  // Gateway, IIS ARR), the value did not pass isIP and sign-in was left without a per-IP
  // limit.
  it("strips the port from IPv4 and from bracketed IPv6", () => {
    expect(pickClientIp("1.2.3.4:5678", 1)).toBe("1.2.3.4");
    expect(pickClientIp("fake, [2001:db8::1]:443", 1)).toBe("2001:db8::1");
    expect(pickClientIp("[::1]", 1)).toBe("::1");
  });

  it("does not split an unbracketed IPv6 nor accept garbage with a port", () => {
    expect(pickClientIp("2001:db8::1:443", 1)).toBe("2001:db8::1:443");
    expect(pickClientIp("unknown:80", 1)).toBeNull();
    expect(pickClientIp("999.1.1.1:80", 1)).toBeNull();
    expect(pickClientIp("[1.2.3.4]:80", 1)).toBeNull();
    expect(pickClientIp("1.2.3.4:123456", 1)).toBeNull();
  });
});

describe("resolveClientIp", () => {
  it("with hops = 0 there is neither an IP nor a problem", () => {
    expect(resolveClientIp("1.2.3.4", 0)).toEqual({ ip: null, problem: null });
    expect(resolveClientIp(null, 0)).toEqual({ ip: null, problem: null });
  });

  it("says why there is no IP when proxies are declared", () => {
    expect(resolveClientIp(null, 1)).toEqual({ ip: null, problem: "missing-header" });
    expect(resolveClientIp("10.0.0.1", 2)).toEqual({
      ip: null,
      problem: "too-few-values",
    });
    expect(resolveClientIp("1.2.3.4, unknown", 1)).toEqual({
      ip: null,
      problem: "not-an-ip",
    });
    expect(resolveClientIp("1.2.3.4", 1)).toEqual({ ip: "1.2.3.4", problem: null });
  });
});

// Warnings are remembered in a module-level Set: each test imports a fresh copy to start
// without previous warnings.
describe("misconfigured proxy warning", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  async function freshPick() {
    return (await import("@/app/lib/client-ip")).pickClientIp;
  }

  it("warns once per reason, without the header or the IP", async () => {
    const pick = await freshPick();
    pick("203.0.113.7, unknown", 1);
    pick("203.0.113.8, unknown", 1);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toMatch(/TRUSTED_PROXY_HOPS=1/);
    expect(message).toMatch(/is not an IP/);
    expect(message).not.toMatch(/203\.0\.113/);
    // There may be another warning with another reason: the text must not promise it is
    // the last one.
    expect(message).toMatch(/once per reason and process/);

    pick("10.0.0.1", 2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toMatch(/fewer values/);
  });

  it("does not warn with hops = 0 nor when it gets the IP", async () => {
    const pick = await freshPick();
    pick(null, 0);
    pick("1.2.3.4", 0);
    pick("1.2.3.4", 1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("parseTrustedProxyHops", () => {
  it("undefined or empty is 0", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(0);
    expect(parseTrustedProxyHops("")).toBe(0);
    expect(parseTrustedProxyHops("  ")).toBe(0);
  });

  it("accepts integers >= 0", () => {
    expect(parseTrustedProxyHops("0")).toBe(0);
    expect(parseTrustedProxyHops("2")).toBe(2);
    expect(parseTrustedProxyHops(" 1 ")).toBe(1);
  });

  it("rejects anything that is not an integer >= 0", () => {
    for (const bad of ["-1", "1.5", "one", "1e2"]) {
      expect(() => parseTrustedProxyHops(bad)).toThrow(/TRUSTED_PROXY_HOPS/);
    }
  });
});
