"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AccessStatusRefresh() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  const refresh = () => {
    setChecking(true);
    router.refresh();
    window.setTimeout(() => setChecking(false), 900);
  };

  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [router]);

  return <div>
    <button type="button" onClick={refresh} disabled={checking}>
      {checking ? "Verificando…" : "Verificar acesso novamente"}
    </button>
    <p aria-live="polite">Esta página verifica a liberação automaticamente.</p>
  </div>;
}
