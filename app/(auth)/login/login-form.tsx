"use client";

import { useActionState } from "react";
import { login, type AuthState } from "@/app/lib/actions/auth";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    login,
    {},
  );

  return (
    <form
      action={action}
      className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8"
    >
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-ink font-bold">
          o
        </span>
        <span className="text-lg font-bold tracking-tight">orgtable</span>
      </div>

      <h1 className="mt-6 text-lg font-semibold">Inicia sesión</h1>
      <p className="mt-1 text-sm text-ink-muted">Accede a tu instancia.</p>

      {state.error && (
        <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="mt-6 space-y-4">
        <label className="block text-sm font-medium">
          Email
          <Input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1.5"
          />
        </label>
        <label className="block text-sm font-medium">
          Contraseña
          <Input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1.5"
          />
        </label>
      </div>

      <Button type="submit" disabled={pending} className="mt-6 w-full">
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
