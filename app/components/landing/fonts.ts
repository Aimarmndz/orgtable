import { Silkscreen, VT323 } from "next/font/google";

// The landing's retro faces, both SIL OFL 1.1 (Google Fonts) and served by the app itself
// like the others (see app/layout.tsx and DESIGN.md). Only the landing loads them.

// Silkscreen: pixel type for micro-labels, window titles and buttons of the terminal.
export const silkscreen = Silkscreen({
  variable: "--font-silkscreen",
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// VT323: the phosphor terminal of the install section.
export const vt323 = VT323({
  variable: "--font-vt323",
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});
