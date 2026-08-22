"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function HandoffLiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let suppressRefreshUntil = 0;
    let navigationRefresh: number | undefined;
    const noteConversationNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a[data-conversation-link='true']")) {
        suppressRefreshUntil = Date.now() + 1_500;
        window.clearTimeout(navigationRefresh);
        navigationRefresh = window.setTimeout(() => router.refresh(), 1_600);
      }
    };
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() >= suppressRefreshUntil) router.refresh();
    };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("click", noteConversationNavigation, { capture: true });
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(navigationRefresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("click", noteConversationNavigation, { capture: true });
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
