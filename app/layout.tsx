import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

// Satoshi (Fontshare) — sans de interfaz y cuerpo. Auto-alojada en app/fonts para no
// depender de ningún CDN en runtime (instancia self-hosted). Ver DESIGN.md.
const satoshi = localFont({
  variable: "--font-satoshi",
  display: "swap",
  src: [
    { path: "./fonts/Satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Satoshi-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/Satoshi-900.woff2", weight: "900", style: "normal" },
  ],
});

// Cabinet Grotesk (Fontshare) — display para titulares con carácter editorial.
const cabinet = localFont({
  variable: "--font-cabinet",
  display: "swap",
  src: [
    { path: "./fonts/CabinetGrotesk-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/CabinetGrotesk-800.woff2", weight: "800", style: "normal" },
    { path: "./fonts/CabinetGrotesk-900.woff2", weight: "900", style: "normal" },
  ],
});

// Geist Mono — solo para números tabulares, metadatos y detalles técnicos.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "orgtable",
  description:
    "Tableros Kanban open-source y self-hosted — una alternativa a Trello",
};

// Se ejecuta antes del primer paint para aplicar el tema guardado (o la preferencia
// del sistema) sin parpadeo. Debe ir inline en <head>.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t!=='light'&&m)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce de la CSP (lo genera proxy.ts). El script del tema es inline y sin él la CSP
  // lo bloquearía: la página parpadearía en claro antes de pasar a oscuro.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${satoshi.variable} ${cabinet.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-ink">{children}</body>
    </html>
  );
}
