"use client";

import { useActionState, useRef, useState } from "react";
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
  // El resultado de copiar va ligado al token al que se refiere: al crear otro token
  // vuelve solo a «idle» sin necesidad de un efecto.
  const [copy, setCopy] = useState<{
    token: string;
    status: "copied" | "error";
  } | null>(null);
  const copyStatus =
    copy && copy.token === state.token ? copy.status : "idle";
  const codeRef = useRef<HTMLElement>(null);

  const copyToken = async () => {
    const token = state.token;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopy({ token, status: "copied" });
      setTimeout(() => setCopy(null), 2000);
    } catch {
      // Por http (contexto no seguro) el portapapeles no existe o se rechaza. El token
      // solo se muestra una vez, así que se avisa y se deja seleccionado para copiarlo
      // a mano. Nunca se registra el token.
      setCopy({ token, status: "error" });
      if (codeRef.current) {
        window.getSelection()?.selectAllChildren(codeRef.current);
      }
    }
  };

  return (
    <div>
      {/* El recuadro existe siempre (sin estilo hasta que hay token) para que la región
          role="status" esté montada antes del aviso. Esa región solo lleva el texto
          corto: si envolviera el token y el botón, el lector de pantalla leería el
          token entero cada vez que cambiara (p. ej. al pasar a «Copiado»). */}
      <div
        className={
          state.token
            ? "mb-4 rounded-xl border border-success/30 bg-success/10 p-4"
            : undefined
        }
      >
        <div role="status">
          {state.token && (
            <>
              <p className="text-sm font-medium">Token «{state.name}» creado</p>
              <p className="mt-1 text-xs text-ink-muted">
                Cópialo ahora: por seguridad no se volverá a mostrar.
              </p>
            </>
          )}
        </div>
        {state.token && (
          <div className="mt-2 flex items-stretch gap-2">
            <code
              ref={codeRef}
              className="min-w-0 flex-1 select-all overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs"
            >
              {state.token}
            </code>
            <Button
              type="button"
              variant="subtle"
              onClick={copyToken}
              className="shrink-0"
            >
              {copyStatus === "copied" ? "Copiado" : "Copiar"}
            </Button>
          </div>
        )}
        {/* Hermano de la región role="status", no hijo: dos regiones vivas anidadas
            pueden anunciar el aviso dos veces. */}
        {state.token && copyStatus === "error" && (
          <p role="alert" className="mt-2 text-xs text-danger">
            No se pudo copiar automáticamente: selecciona el token y cópialo a
            mano.
          </p>
        )}
      </div>

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
            defaultValue={state.values?.name}
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Permisos
          </span>
          {/* Tras un error se conserva lo elegido. La key remonta el <select>: React
              no actualiza el defaultValue de uno ya montado y el reset automático del
              formulario lo devolvería al valor inicial. */}
          <select
            key={state.values?.scope ?? "full"}
            name="scope"
            defaultValue={state.values?.scope ?? "full"}
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
            key={state.values?.expiry ?? "0"}
            name="expiry"
            defaultValue={state.values?.expiry ?? "0"}
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
        <p
          role="alert"
          className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
