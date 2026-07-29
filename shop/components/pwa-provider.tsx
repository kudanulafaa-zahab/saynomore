"use client";

import { useEffect } from "react";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";

export function PwaProvider({ children }: { children: React.ReactNode }) {
  useKeyboardInset(true);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;

    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return <>{children}</>;
}
