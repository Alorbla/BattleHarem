import type { Metadata } from "next";
import "./globals.css";
import "./sakura.css";

export const metadata: Metadata = {
  title: "Battle Harem — Zahraj svoju kombináciu",
  description: "Originálna online kartová hra pre 2–8 hráčov. Vytvor miestnosť, pozvi priateľov a zabojuj o víťaznú zostavu.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sk">
      <body className="antialiased">{children}</body>
    </html>
  );
}
