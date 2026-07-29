"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallContextValue {
  // true only on Android/desktop Chrome-family browsers that fired the
  // event AND haven't already been installed — the only case with a real
  // native install button. iOS never fires this; it gets the walkthrough.
  canPromptInstall: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

const InstallContext = createContext<InstallContextValue>({
  canPromptInstall: false,
  promptInstall: async () => "unavailable",
});

export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    // Chrome removes the ability to re-prompt once installed — clear our
    // captured event so the button/sheet disappears immediately.
    const installedHandler = () => setDeferredEvent(null);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return "unavailable" as const;
    await deferredEvent.prompt();
    const choice = await deferredEvent.userChoice;
    setDeferredEvent(null); // the captured event is single-use
    return choice.outcome;
  }, [deferredEvent]);

  return (
    <InstallContext.Provider value={{ canPromptInstall: !!deferredEvent, promptInstall }}>
      {children}
    </InstallContext.Provider>
  );
}

export function useInstallPrompt() {
  return useContext(InstallContext);
}
