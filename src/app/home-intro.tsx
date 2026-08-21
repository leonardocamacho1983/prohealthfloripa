"use client";

import { useEffect, useState } from "react";

import styles from "./home.module.css";

const SESSION_KEY = "prohealth-home-intro-seen";

export function HomeIntro() {
  const [active, setActive] = useState(true);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const alreadySeen = window.sessionStorage.getItem(SESSION_KEY) === "true";

    if (reduceMotion || alreadySeen) {
      const frame = window.requestAnimationFrame(() => setActive(false));
      return () => window.cancelAnimationFrame(frame);
    }

    const timeout = window.setTimeout(() => {
      window.sessionStorage.setItem(SESSION_KEY, "true");
      setActive(false);
    }, 1850);

    return () => window.clearTimeout(timeout);
  }, []);

  function skipIntro() {
    window.sessionStorage.setItem(SESSION_KEY, "true");
    setActive(false);
  }

  if (!active) return null;

  return (
    <div className={styles.intro} aria-label="Abertura da ProHealth">
      <button className={styles.introSkip} type="button" onClick={skipIntro}>
        Pular
      </button>
      <svg
        className={styles.introGeometry}
        viewBox="0 0 640 260"
        role="img"
        aria-label="Linha luminosa formando a identidade ProHealth"
      >
        <path className={styles.introPathWarm} d="M22 205 L160 205 L248 126 L410 126 L514 42 L618 42" />
        <path className={styles.introPathIce} d="M183 205 L320 72 L462 205 L594 72" />
      </svg>
      <div className={styles.introWordmark}>
        <strong>PRO HEALTH</strong>
        <span>SAÚDE E PERFORMANCE</span>
      </div>
    </div>
  );
}
