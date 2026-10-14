import { describe, it, expect } from "vitest";
import { describeUserAgent, parseUserAgent } from "@/app/lib/user-agent";
import { messagesFor } from "@/app/i18n/config";

const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";

describe("parseUserAgent", () => {
  it.each([
    [FIREFOX_MAC, "Firefox", "macOS"],
    [CHROME_ANDROID, "Chrome", "Android"],
    [EDGE_WINDOWS, "Edge", "Windows"],
    [SAFARI_IOS, "Safari", "iOS"],
  ])("%s → %s / %s", (ua, browser, os) => {
    expect(parseUserAgent(ua)).toEqual({ browser, os });
  });

  it("returns null for what it does not recognise", () => {
    expect(parseUserAgent("curl/8.7.1")).toEqual({ browser: null, os: null });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
  });

  it("recognises the system without the browser and vice versa", () => {
    expect(parseUserAgent("SomeBot (Linux)")).toEqual({ browser: null, os: "Linux" });
    expect(parseUserAgent("Firefox/131.0")).toEqual({ browser: "Firefox", os: null });
  });
});

describe("describeUserAgent", () => {
  const en = messagesFor("en").settings.security;
  const es = messagesFor("es").settings.security;

  it.each([
    [FIREFOX_MAC, "Firefox on macOS"],
    [CHROME_ANDROID, "Chrome on Android"],
    [EDGE_WINDOWS, "Edge on Windows"],
    [SAFARI_IOS, "Safari on iOS"],
    ["curl/8.7.1", "Unknown browser"],
  ])("%s → %s", (ua, expected) => {
    expect(describeUserAgent(ua, en)).toBe(expected);
  });

  it("without a user-agent", () => {
    expect(describeUserAgent(null, en)).toBe("Unknown browser");
  });

  it("uses only the browser or the system when the other one is unknown", () => {
    expect(describeUserAgent("Firefox/131.0", en)).toBe("Firefox");
    expect(describeUserAgent("SomeBot (Linux)", en)).toBe("Linux");
  });

  it("uses the templates of the reader's language", () => {
    expect(describeUserAgent(FIREFOX_MAC, es)).toBe("Firefox en macOS");
    expect(describeUserAgent(null, es)).toBe("Navegador desconocido");
  });
});
