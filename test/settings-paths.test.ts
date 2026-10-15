import { describe, it, expect } from "vitest";
import { ACCOUNT_SETTINGS, settingsPathForFragment } from "@/app/lib/settings-paths";

// Old /settings#<section> links (bookmarks, the privacy policy, emails already sent) must
// still land on the page that section became.
describe("settingsPathForFragment", () => {
  it("maps every old fragment to its page", () => {
    expect(settingsPathForFragment("#profile")).toBe(ACCOUNT_SETTINGS.profile);
    expect(settingsPathForFragment("#security")).toBe(ACCOUNT_SETTINGS.security);
    expect(settingsPathForFragment("#api")).toBe(ACCOUNT_SETTINGS.tokens);
    expect(settingsPathForFragment("#appearance")).toBe(ACCOUNT_SETTINGS.appearance);
    expect(settingsPathForFragment("#data")).toBe(ACCOUNT_SETTINGS.data);
    expect(settingsPathForFragment("about")).toBe(ACCOUNT_SETTINGS.data);
  });

  it("opens the profile for no fragment or an unknown one", () => {
    expect(settingsPathForFragment("")).toBe(ACCOUNT_SETTINGS.profile);
    expect(settingsPathForFragment("#whatever")).toBe(ACCOUNT_SETTINGS.profile);
  });
});
