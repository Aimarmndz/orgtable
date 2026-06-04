"use client";

import { useActionState } from "react";
import { login, type AuthState } from "@/app/lib/actions/auth";

const inputClass =
  "mt-1 w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    login,
    {},
  );

  return (
    <form
      action={action}
      className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm ring-1 ring-black/5"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Accede a tu instancia de orgtable.
      </p>

      {state.error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <label className="mt-6 block text-sm font-medium">
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
          autoComplete="current-password"
          className={inputClass}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
