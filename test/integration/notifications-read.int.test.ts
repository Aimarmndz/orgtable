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

// Regression: opening a notification with a board did not refresh the router, and the
// layout's unread counter stayed the same. Now the actions mark it as read and call
// refresh() from next/cache. The badge itself is only visible in the browser; here the
// data is checked, and that the refresh is requested.

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  refresh: refreshMock,
}));

async function seedNotification(userId: string, boardId: string | null = null) {
  return prisma.notification.create({
    data: { userId, type: "board.added", title: "You were added", boardId },
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

describe("notification actions", () => {
  it("markNotificationRead marks your own as read and requests a refresh", async () => {
    const user = await seedUser();
    const n = await seedNotification(user.id, "any-board");
    await loginAs(user.id);

    await markNotificationRead(n.id);

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: n.id },
    });
    expect(after.read).toBe(true);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("markNotificationRead does not touch someone else's notifications", async () => {
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

  it("markAllNotificationsRead marks all of your own and requests a refresh", async () => {
    const user = await seedUser();
    const other = await seedUser();
    await seedNotification(user.id);
    await seedNotification(user.id, "any-board");
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
