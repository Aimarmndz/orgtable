import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterAll,
} from "vitest";
import { prisma } from "@/app/lib/prisma";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/app/lib/actions/notifications";
import { resetDb, disconnect, seedUser, loginAs } from "./helpers";

// Regresión: al abrir una notificación con tablero no se refrescaba el router y el
// contador de no leídas del layout se quedaba igual. Ahora las acciones marcan como
// leída y llaman a refresh() de next/cache. El badge en sí solo se ve en el navegador;
// aquí se comprueba el dato y que se pide el refresh.

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  refresh: refreshMock,
}));

async function seedNotification(userId: string, boardId: string | null = null) {
  return prisma.notification.create({
    data: { userId, type: "board.added", title: "Te añadieron", boardId },
    select: { id: true },
  });
}

beforeEach(async () => {
  await resetDb();
  refreshMock.mockClear();
});

afterAll(async () => {
  await disconnect();
});

describe("acciones de notificaciones", () => {
  it("markNotificationRead marca la propia como leída y pide refresh", async () => {
    const user = await seedUser();
    const n = await seedNotification(user.id, "tablero-cualquiera");
    await loginAs(user.id);

    await markNotificationRead(n.id);

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: n.id },
    });
    expect(after.read).toBe(true);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("markNotificationRead no toca las notificaciones de otra persona", async () => {
    const user = await seedUser();
    const other = await seedUser();
    const foreign = await seedNotification(other.id);
    await loginAs(user.id);

    await markNotificationRead(foreign.id);

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: foreign.id },
    });
    expect(after.read).toBe(false);
  });

  it("markAllNotificationsRead marca todas las propias y pide refresh", async () => {
    const user = await seedUser();
    const other = await seedUser();
    await seedNotification(user.id);
    await seedNotification(user.id, "tablero-cualquiera");
    await seedNotification(other.id);
    await loginAs(user.id);

    await markAllNotificationsRead();

    expect(
      await prisma.notification.count({ where: { userId: user.id, read: false } }),
    ).toBe(0);
    expect(
      await prisma.notification.count({ where: { userId: other.id, read: false } }),
    ).toBe(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
