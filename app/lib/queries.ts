import "server-only";
import { prisma } from "@/app/lib/prisma";

// Consultas de lectura. La autorización (qué tableros puede ver un usuario) se
// expresa en el propio WHERE: dueño o miembro del tablero.

export async function getBoardsForUser(userId: string) {
  return prisma.board.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getBoardWithLists(boardId: string, userId: string) {
  return prisma.board.findFirst({
    where: {
      id: boardId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    include: {
      labels: { orderBy: { name: "asc" } },
      lists: {
        orderBy: { position: "asc" },
        include: {
          cards: {
            orderBy: { position: "asc" },
            include: {
              labels: { include: { label: true } },
              checklists: {
                orderBy: { position: "asc" },
                include: { items: { orderBy: { position: "asc" } } },
              },
            },
          },
        },
      },
    },
  });
}
