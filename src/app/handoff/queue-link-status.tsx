"use client";

import { useLinkStatus } from "next/link";

import styles from "./handoff.module.css";

export function QueueLinkStatus() {
  const { pending } = useLinkStatus();

  return <span className={`${styles.queueLinkStatus} ${pending ? styles.queueLinkPending : ""}`}
    aria-live="polite" aria-atomic="true">
    {pending ? "Abrindo…" : ""}
  </span>;
}
