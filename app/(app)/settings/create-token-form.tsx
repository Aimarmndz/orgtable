"use client";

import { useActionState, useState } from "react";
import { createApiToken, type CreateTokenState } from "@/app/lib/actions/tokens";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

// Alta de un token de API (Hito 9). useActionState devuelve el token EN CLARO una sola
// vez; se muestra con un botón de copiar y un aviso de que no se volverá a ver.
export function CreateTokenForm() {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(
    createApiToken,
    {},
  );
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // El portapapeles puede no estar disponible; el token sigue siendo seleccionable.
    }
  };

  return (
    <div>
      {state.token && (
        <div className="mb-4 rounded-xl border border-success/30 bg-success/10 p-4">
          <p className="text-sm font-medium">Token «{state.name}» creado</p>
          <p className="mt-1 text-xs text-ink-muted">
            Cópialo ahora: por seguridad no se volverá a mostrar.
          </p>
          <div className="mt-2 flex items-stretch gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs">
              {state.token}
            </code>
            <Button
              type="button"
              variant="subtle"
              onClick={copy}
              className="shrink-0"
            >
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Nombre del token
          </span>
          <Input
            name="name"
            required
            maxLength={60}
            placeholder="p. ej. Script de backup"
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Permisos
          </span>
          <select
            name="scope"
            defaultValue="full"
            className="mt-1.5 h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
          >
            <option value="full">Lectura y escritura</option>
            <option value="read">Solo lectura</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Caduca
          </span>
          <select
            name="expiry"
            defaultValue="0"
            className="mt-1.5 h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
          >
            <option value="0">Nunca</option>
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="365">1 año</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando…" : "Crear token"}
        </Button>
      </form>

      {state.error && (
        <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
