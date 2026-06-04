"use client";

import { useActionState } from "react";
import { completeSetup, type SetupState } from "@/app/lib/actions/setup";

const inputClass =
  "mt-1 w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(
    completeSetup,
    {},
  );

  return (
    <form
      action={action}
      className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-black/5"
    >
      <h1 className="text-2xl font-semibold tracking-tight">
        Configura tu orgtable
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Este asistente solo aparece una vez. Crea tu cuenta de administrador.
      </p>

      {state.error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Instancia
        </legend>
        <label className="mt-3 block text-sm font-medium">
          Nombre de la instancia
          <input
            name="instanceName"
            type="text"
            required
            maxLength={60}
            placeholder="Mi equipo"
            className={inputClass}
          />
        </label>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Administrador
        </legend>
        <label className="mt-3 block text-sm font-medium">
          Tu nombre
          <input
            name="name"
            type="text"
            required
            maxLength={60}
            autoComplete="name"
            className={inputClass}
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputClass}
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Contraseña
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-zinc-400">
            Mínimo 8 caracteres.
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? "Creando…" : "Crear y entrar"}
      </button>
    </form>
  );
}
