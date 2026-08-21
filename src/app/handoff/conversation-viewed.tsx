"use client";

import { useEffect, useRef } from "react";

export function ConversationViewed({ conversationId }: { conversationId: string }) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = marker.current;
    if (!element) return;
    let sent = false;
    const mark = () => {
      if (sent || document.visibilityState !== "visible" || !document.hasFocus()) return;
      sent = true;
      void fetch(`/api/handoff/${conversationId}/viewed`, { method: "POST", keepalive: true });
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) mark();
    }, { threshold: 0.25 });
    observer.observe(element);
    const onFocus = () => mark();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      observer.disconnect();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [conversationId]);
  return <div ref={marker} aria-hidden="true" />;
}

