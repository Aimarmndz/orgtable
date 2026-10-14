import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { cookies } from "next/headers";
import { prisma } from "@/app/lib/prisma";
import { setLocale } from "@/app/lib/actions/locale";
import { login } from "@/app/lib/actions/auth";
import { __getCookieOptions, __setHeaders } from "../stubs/next-headers";
import { resetDb, disconnect, seedUser, loginAs, en, es } from "./helpers";

// setLocale (language picker): stores the choice in the `locale` cookie and, when signed
// in, in User.locale, so that notifications for that person are written in it.

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

function localeForm(locale: string): FormData {
  const fd = new FormData();
  fd.set("locale", locale);
  return fd;
}

async function localeCookie(): Promise<string | undefined> {
  return (await cookies()).get("locale")?.value;
}

async function storedLocale(userId: string): Promise<string | null> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale;
}

describe("setLocale (integration)", () => {
  it("stores the cookie and User.locale for a signed-in user", async () => {
    const user = await seedUser();
    await loginAs(user.id);

    await setLocale(localeForm("es"));

    expect(await localeCookie()).toBe("es");
    expect(__getCookieOptions("locale")).toMatchObject({
      path: "/",
      sameSite: "lax",
      secure: false,
    });
    expect(await storedLocale(user.id)).toBe("es");

    await setLocale(localeForm("en"));
    expect(await localeCookie()).toBe("en");
    expect(await storedLocale(user.id)).toBe("en");
  });

  it("marks the cookie Secure behind HTTPS", async () => {
    __setHeaders({ "x-forwarded-proto": "https" });
    await setLocale(localeForm("es"));
    expect(__getCookieOptions("locale")).toMatchObject({ secure: true });
  });

  it("without a session only stores the cookie", async () => {
    const user = await seedUser();

    await setLocale(localeForm("es"));

    expect(await localeCookie()).toBe("es");
    expect(await storedLocale(user.id)).toBeNull();
  });

  it("rejects an unknown code: no cookie and User.locale unchanged", async () => {
    const user = await seedUser();
    await loginAs(user.id);

    for (const bad of ["xx", "ES", "", "constructor", "es;q=1"]) {
      await setLocale(localeForm(bad));
    }
    await setLocale(new FormData());

    expect(await localeCookie()).toBeUndefined();
    expect(await storedLocale(user.id)).toBeNull();
  });

  it("an unknown code does not overwrite an earlier valid choice", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    await setLocale(localeForm("es"));

    await setLocale(localeForm("xx"));

    expect(await localeCookie()).toBe("es");
    expect(await storedLocale(user.id)).toBe("es");
  });

  it("after choosing Spanish, the actions answer in Spanish", async () => {
    expect((await login({}, loginForm())).error).toBe(en.errors.auth.invalidCredentials);

    await setLocale(localeForm("es"));

    expect((await login({}, loginForm())).error).toBe(es.errors.auth.invalidCredentials);
  });
});

function loginForm(): FormData {
  const fd = new FormData();
  fd.set("email", "someone@test.local");
  fd.set("password", "wrong-password");
  return fd;
}
