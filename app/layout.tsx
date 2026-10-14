import type { Metadata } from "next";
import { getI18n } from "@/app/i18n/server";
import { I18nProvider } from "@/app/i18n/client";
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

// Each page exports its own `title` and the template appends the app name, so every route
// has a distinct title (WCAG 2.4.2). The description follows the visitor's language.
export async function generateMetadata(): Promise<Metadata> {
  const { m, intl } = await getI18n();
  return {
    title: { template: "%s · orgtable", default: "orgtable" },
    description: m.common.tagline,
    applicationName: "orgtable",
    openGraph: {
      type: "website",
      siteName: "orgtable",
      title: "orgtable",
      description: m.common.tagline,
      locale: intl.replace("-", "_"),
    },
  };
}

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
  const { locale, intl, m } = await getI18n();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${figtree.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-ink">
        <I18nProvider locale={locale} intl={intl} messages={m}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
