import type { Metadata } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, Figtree, Geist_Mono } from "next/font/google";
import "./globals.css";

// Todas las fuentes son OFL (Google Fonts). next/font las descarga en el build y las sirve
// desde la propia app: en runtime no se pide nada a ningún CDN. Las anteriores (Satoshi y
// Cabinet Grotesk, de Fontshare) prohíben redistribuir los ficheros en un repositorio
// público, incompatible con publicar el código bajo AGPL. Ver DESIGN.md.

// Figtree — sans de interfaz y cuerpo.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// Bricolage Grotesque — display para titulares y la marca, con carácter editorial.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// Geist Mono — solo para números tabulares, metadatos y detalles técnicos.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Cada página exporta su propio `title` y la plantilla le añade el nombre de la app, para
// que cada ruta tenga un título distinto (WCAG 2.4.2).
export const metadata: Metadata = {
  title: { template: "%s · orgtable", default: "orgtable" },
  description: "Tableros Kanban self-hosted, una alternativa a Trello",
  applicationName: "orgtable",
  openGraph: {
    type: "website",
    siteName: "orgtable",
    title: "orgtable",
    description: "Tableros Kanban de código abierto: tus listas y tarjetas, en tiempo real.",
    locale: "es_ES",
  },
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
      className={`${figtree.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-ink">{children}</body>
    </html>
  );
}
