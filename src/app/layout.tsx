import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aplicação",
  description: "Aplicação web em desenvolvimento.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
