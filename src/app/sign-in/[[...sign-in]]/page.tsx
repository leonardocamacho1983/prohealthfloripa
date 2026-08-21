import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthShell, clerkAppearance } from "../../auth-shell";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Acesso da equipe à plataforma de atendimento da ProHealth.",
};

export default function SignInPage() {
  return (
    <AuthShell title="Entre na plataforma" description="Use o e-mail cadastrado para acessar seus atendimentos.">
      <SignIn
        appearance={clerkAppearance}
        fallbackRedirectUrl="/handoff"
        path="/sign-in"
        routing="path"
        withSignUp
      />
    </AuthShell>
  );
}
