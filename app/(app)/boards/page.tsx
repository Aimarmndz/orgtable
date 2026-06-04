import Link from "next/link";
import { requireUser } from "@/app/lib/dal";
import { getBoardsForUser } from "@/app/lib/queries";
import { createBoard, deleteBoard } from "@/app/lib/actions/boards";

export default async function BoardsPage() {
  const user = await requireUser();
  const boards = await getBoardsForUser(user.id);

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Tus tableros</h1>

      <form action={createBoard} className="mt-6 flex gap-2">
        <input
          name="title"
          required
          maxLength={120}
          placeholder="Nombre del nuevo tablero"
          className="flex-1 rounded-md border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
        <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700">
          Crear tablero
        </button>
      </form>

      {boards.length === 0 ? (
        <p className="mt-10 text-center text-sm text-zinc-500">
          Todavía no tienes tableros. Crea el primero arriba.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <li
              key={board.id}
              className="group relative flex h-28 flex-col justify-between rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5 transition hover:shadow-md"
            >
              <Link
                href={`/board/${board.id}`}
                className="text-base font-medium after:absolute after:inset-0"
              >
                {board.title}
              </Link>
              <form action={deleteBoard} className="relative z-10 self-end">
                <input type="hidden" name="boardId" value={board.id} />
                <button
                  className="rounded px-2 py-1 text-xs text-zinc-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                  aria-label={`Borrar ${board.title}`}
                >
                  Borrar
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
