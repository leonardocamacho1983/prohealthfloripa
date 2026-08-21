import { ClerkProvider } from "@clerk/nextjs";
import { ptBR } from "@clerk/localizations/pt-BR";
import type { Metadata } from "next";
import "../styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://prohealthfloripa.vercel.app"),
  title: {
    default: "ProHealth Floripa | Movimento, recuperação e performance",
    template: "%s | ProHealth Floripa",
  },
  description:
    "Pilates, fisioterapia, massagens, termoterapias e preparação física no Córrego Grande, em Florianópolis.",
  openGraph: {
    title: "ProHealth Floripa | Movimento, recuperação e performance",
    description:
      "Pilates, fisioterapia, massagens, termoterapias e preparação física para atletas e pessoas ativas.",
    locale: "pt_BR",
    type: "website",
    images: [{
      url: "/images/generated/prohealth-hero-human-performance-desktop-v1.png",
      width: 1672,
      height: 941,
      alt: "ProHealth Saúde e Performance em Florianópolis",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ProHealth Floripa",
    description: "Movimento, recuperação e performance. No mesmo lugar.",
    images: ["/images/generated/prohealth-hero-human-performance-desktop-v1.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>
        <ClerkProvider
          localization={ptBR}
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/handoff"
          signUpFallbackRedirectUrl="/welcome"
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
