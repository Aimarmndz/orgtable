import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { register } from "@/app/lib/actions/register";
import { saveInstanceSettings } from "@/app/lib/actions/instance";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import { verifySession } from "@/app/lib/dal";
import { __setHeaders } from "../stubs/next-headers";
import { resetDb, disconnect, seedUser, loginAs } from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

const LEGAL = { operatorName: "Operador de prueba", operatorEmail: "privacidad@test.local" };

async function seedInstance(data: Partial<{ registrationOpen: boolean; operatorName: string; operatorEmail: string }> = {}) {
  await prisma.instanceConfig.create({
    data: { id: "singleton", instanceName: "Prueba", setupCompletedAt: new Date(), ...data },
  });
}

function form(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, v);
  return fd;
}

function registerForm(fields: Record<string, string | undefined> = {}): FormData {
  return form({
    name: "Persona Nueva",
    email: "Nueva@Test.local",
    password: "contraseña-larga",
    acceptTerms: "on",
    ...fields,
  });
}

/** Ejecuta register y devuelve la URL de la redirección (o falla si no redirige). */
async function registerRedirect(fd: FormData): Promise<string> {
  try {
    const state = await register({}, fd);
    throw new Error(`register no redirigió: ${JSON.stringify(state)}`);
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (!digest?.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2];
  }
}

describe("registro abierto (register)", () => {
  it("crea una cuenta MEMBER, guarda la aceptación, inicia sesión y audita", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    const before = Date.now();

    expect(await registerRedirect(registerForm())).toBe("/boards");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nueva@test.local" } });
    expect(user.role).toBe("MEMBER");
    expect(user.termsAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(user.passwordHash).not.toContain("contraseña");
    expect((await verifySession())?.userId).toBe(user.id);
    expect(
      await prisma.auditLog.count({ where: { action: "auth.registered", userId: user.id } }),
    ).toBe(1);
  });

  it("con el registro cerrado no crea nada", async () => {
    await seedInstance({ registrationOpen: false, ...LEGAL });
    const state = await register({}, registerForm());
    expect(state.error).toBe("El registro está cerrado en esta instancia.");
    expect(await prisma.user.count()).toBe(0);
  });

  // Defensa en profundidad: si alguien vacía los datos legales directamente en la BD, el
  // registro se cierra solo en vez de aceptar altas sin política de privacidad completa.
  it("abierto pero sin responsable ni contacto cuenta como cerrado", async () => {
    await seedInstance({ registrationOpen: true });
    expect(await isRegistrationOpen()).toBe(false);
    const state = await register({}, registerForm());
    expect(state.error).toBe("El registro está cerrado en esta instancia.");
    expect(await prisma.user.count()).toBe(0);
  });

  it("sin aceptar la política y las condiciones no crea la cuenta", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    const state = await register({}, registerForm({ acceptTerms: undefined }));
    expect(state.field).toBe("acceptTerms");
    expect(state.error).toMatch(/aceptar la política de privacidad/);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rechaza el campo trampa relleno sin dar pistas", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    const state = await register({}, registerForm({ website: "https://spam.example" }));
    expect(state.error).toBe("No se pudo crear la cuenta. Inténtalo de nuevo.");
    expect(await prisma.user.count()).toBe(0);
  });

  it("un email ya registrado (en otra capitalización) no crea otra cuenta", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    await seedUser({ email: "nueva@test.local" });
    const state = await register({}, registerForm());
    expect(state).toMatchObject({ field: "email", values: { email: "Nueva@Test.local" } });
    expect(await prisma.user.count()).toBe(1);
  });

  it("dos altas simultáneas con el mismo email: una cuenta y ningún error 500", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    const results = await Promise.allSettled([
      registerRedirect(registerForm()),
      registerRedirect(registerForm()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("Ya existe una cuenta con ese email");
    expect(await prisma.user.count()).toBe(1);
  });

  it("limita las altas por IP cuando hay proxy de confianza", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    process.env.TRUSTED_PROXY_HOPS = "1";
    __setHeaders({ "x-forwarded-for": "203.0.113.7" });
    try {
      for (let i = 0; i < 5; i++) {
        await registerRedirect(registerForm({ email: `p${i}@test.local` }));
      }
      const state = await register({}, registerForm({ email: "p6@test.local" }));
      expect(state.error).toMatch(/demasiadas cuentas seguidas/);
      expect(await prisma.user.count()).toBe(5);
      expect(
        await prisma.auditLog.count({ where: { action: "auth.register_rate_limited" } }),
      ).toBe(1);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });
});

describe("ajustes de la instancia (saveInstanceSettings)", () => {
  function settingsForm(fields: Record<string, string> = {}): FormData {
    return form({
      instanceName: "Prueba",
      registrationOpen: "closed",
      operatorName: "",
      operatorEmail: "",
      operatorLegalId: "",
      operatorAddress: "",
      hostingDescription: "",
      backupRetentionDays: "",
      ...fields,
    });
  }

  it("no deja abrir el registro sin responsable y contacto", async () => {
    await seedInstance();
    const admin = await seedUser({ role: "ADMIN" });
    await loginAs(admin.id);

    const state = await saveInstanceSettings({}, settingsForm({ registrationOpen: "open" }));
    expect(state.field).toBe("registrationOpen");
    expect(state.values?.registrationOpen).toBe("open");
    expect((await prisma.instanceConfig.findUniqueOrThrow({ where: { id: "singleton" } })).registrationOpen).toBe(false);
  });

  it("guarda los datos legales, abre el registro y fecha la actualización", async () => {
    await seedInstance();
    const admin = await seedUser({ role: "ADMIN" });
    await loginAs(admin.id);

    const state = await saveInstanceSettings(
      {},
      settingsForm({
        registrationOpen: "open",
        operatorName: "  Operador  ",
        operatorEmail: "privacidad@test.local",
        backupRetentionDays: "14",
      }),
    );
    expect(state.message).toBe("Ajustes guardados.");

    const config = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(config).toMatchObject({
      registrationOpen: true,
      operatorName: "Operador",
      operatorEmail: "privacidad@test.local",
      operatorLegalId: null,
      backupRetentionDays: 14,
    });
    expect(config.legalUpdatedAt).toBeInstanceOf(Date);
    expect(await isRegistrationOpen()).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "instance.updated" } })).toBe(1);
  });

  it("rechaza un email de contacto no válido", async () => {
    await seedInstance();
    const admin = await seedUser({ role: "ADMIN" });
    await loginAs(admin.id);
    const state = await saveInstanceSettings({}, settingsForm({ operatorEmail: "no-es-email" }));
    expect(state.field).toBe("operatorEmail");
  });

  it("un MEMBER no puede cambiar los ajustes", async () => {
    await seedInstance();
    const member = await seedUser();
    await loginAs(member.id);
    await expect(
      saveInstanceSettings({}, settingsForm({ registrationOpen: "open", ...LEGAL })),
    ).rejects.toMatchObject({ digest: expect.stringContaining(";/boards;") });
    expect((await prisma.instanceConfig.findUniqueOrThrow({ where: { id: "singleton" } })).operatorName).toBeNull();
  });
});
