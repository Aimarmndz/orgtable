import Link from "next/link";
import { requireUser } from "@/app/lib/dal";
import { getBoardsForUser } from "@/app/lib/queries";
import { createBoard, deleteBoard } from "@/app/lib/actions/boards";
import { boardBackgroundFor } from "@/app/lib/colors";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { ImportBoardForm } from "./import-board-form";

export default async function BoardsPage() {
  const user = await requireUser();
  const boards = await getBoardsForUser(user.id);

  return (
    <div className="mx-auto w-full max-w-6xl overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        Tus tableros
      </h1>

      <form action={createBoard} className="mt-6 flex gap-2">
        <Input
          name="title"
          required
          maxLength={120}
          placeholder="Nombre del nuevo tablero"
          className="max-w-xs"
        />
        <Button type="submit">Crear tablero</Button>
      </form>

      <div className="mt-3">
        <ImportBoardForm />
      </div>

      {boards.length === 0 ? (
        <div className="mt-20 flex flex-col items-center text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-2xl">
            🗂️
          </div>
          <p className="mt-4 font-medium">Todavía no tienes tableros</p>
          <p className="mt-1 max-w-xs text-sm text-ink-muted">
            Crea el primero con el campo de arriba y empieza a organizar tu
            trabajo en listas y tarjetas.
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {boards.map((board) => (
            <li key={board.id} className="group relative">
              <Link
                href={`/board/${board.id}`}
                style={{ background: boardBackgroundFor(board) }}
                className="flex h-28 flex-col justify-end rounded-xl p-4 text-white transition-transform duration-150 ease-out hover:-translate-y-0.5"
              >
                <span className="font-semibold drop-shadow-sm">
                  {board.title}
                </span>
              </Link>
              <div className="absolute right-2 top-2 flex gap-1">
                <a
                  href={`/api/boards/${board.id}/export`}
                  className="grid size-7 place-items-center rounded-md bg-black/20 text-white/90 opacity-0 transition hover:bg-black/40 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Exportar tablero ${board.title}`}
                  title="Exportar a JSON"
                >
                  <svg
                    className="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </a>
                <form action={deleteBoard}>
                  <input type="hidden" name="boardId" value={board.id} />
                  <button
                    className="grid size-7 place-items-center rounded-md bg-black/20 text-sm text-white/90 opacity-0 transition hover:bg-black/40 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Borrar tablero ${board.title}`}
                  >
                    ✕
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
