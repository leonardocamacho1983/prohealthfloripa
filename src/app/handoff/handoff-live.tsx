"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function HandoffLiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let suppressRefreshUntil = 0;
    const noteConversationNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a[data-conversation-link='true']")) {
        suppressRefreshUntil = Date.now() + 30_000;
      }
    };
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() >= suppressRefreshUntil) router.refresh();
    };
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("click", noteConversationNavigation, { capture: true });
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("click", noteConversationNavigation, { capture: true });
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
