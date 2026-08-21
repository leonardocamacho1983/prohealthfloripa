import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AuthShell, clerkAppearance } from "../../auth-shell";

export const metadata: Metadata = {
  title: "Criar acesso",
  description: "Ativação do acesso da equipe à plataforma de atendimento da ProHealth.",
};

export default function SignUpPage() {
  return (
    <AuthShell title="Crie seu acesso" description="Complete seu cadastro para aceitar o convite da ProHealth.">
      <SignUp
        appearance={clerkAppearance}
        fallbackRedirectUrl="/welcome"
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
      />
    </AuthShell>
  );
}
