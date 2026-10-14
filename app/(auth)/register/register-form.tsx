"use client";

import Link from "next/link";
import { useActionState } from "react";
import { register, type RegisterState } from "@/app/lib/actions/register";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

export function RegisterForm({ operatorName }: { operatorName: string }) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(register, {});
  const invalid = (f: RegisterState["field"]) => (state.field === f && !pending) || undefined;

  return (
    <form action={action} className="w-full max-w-sm">
      <div className="flex items-center gap-2.5 lg:hidden">
        <span className="grid size-8 place-items-center rounded-lg bg-accent font-display text-lg font-extrabold text-accent-ink">
          o
        </span>
        <span className="font-display text-lg font-bold tracking-tight">orgtable</span>
      </div>

      <h1 className="mt-8 font-display text-3xl font-bold tracking-tight lg:mt-0">
        Crea tu cuenta
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Es gratis. ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-semibold text-accent underline-offset-2 hover:underline">
          Inicia sesión
        </Link>
      </p>

      {/* Se retira mientras se envía: así un segundo error idéntico se vuelve a anunciar. */}
      {state.error && !pending && (
        <p
          role="alert"
          id="register-error"
          className="mt-5 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <div className="mt-7 space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            Nombre
          </label>
          <Input
            id="name"
            name="name"
            required
            maxLength={60}
            autoComplete="name"
            defaultValue={state.values?.name}
            aria-invalid={invalid("name")}
            aria-describedby={invalid("name") ? "register-error" : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="tu@correo.com"
            defaultValue={state.values?.email}
            aria-invalid={invalid("email")}
            aria-describedby={invalid("email") ? "register-error" : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            aria-invalid={invalid("password")}
            aria-describedby={invalid("password") ? "register-error password-hint" : "password-hint"}
          />
          <p id="password-hint" className="text-xs text-ink-muted">
            Al menos 8 caracteres.
          </p>
        </div>

        {/* Campo trampa para bots: fuera de la vista y del orden de tabulación. Las
            personas no lo ven ni lo rellenan; si llega con texto, el alta se rechaza. */}
        <div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
          <label htmlFor="website">No rellenes este campo</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label className="flex items-start gap-2.5 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="acceptTerms"
            required
            className="mt-1 size-4 shrink-0 accent-accent"
            aria-invalid={invalid("acceptTerms")}
          />
          <span>
            He leído la{" "}
            <Link href="/legal/privacidad" className="font-medium text-accent underline underline-offset-2">
              política de privacidad
            </Link>{" "}
            y acepto las{" "}
            <Link href="/legal/condiciones" className="font-medium text-accent underline underline-offset-2">
              condiciones de uso
            </Link>
            .
          </span>
        </label>
      </div>

      <Button type="submit" disabled={pending} className="mt-7 w-full">
        {pending ? "Creando la cuenta…" : "Crear cuenta"}
      </Button>

      {/* Primera capa de información (art. 13 RGPD): lo esencial junto al formulario y el
          resto en la política enlazada arriba. */}
      <p className="mt-5 text-xs leading-relaxed text-ink-muted">
        Responsable: {operatorName}. Finalidad: darte la cuenta y el servicio. No se cede a
        nadie. Puedes descargar o borrar tus datos desde los ajustes cuando quieras.
      </p>
    </form>
  );
}
