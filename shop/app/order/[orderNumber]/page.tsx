"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { InstallSheet } from "@/components/install/install-sheet";
import { useInstallTrigger } from "@/components/install/use-install-trigger";

export default function OrderConfirmationPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = use(params);
  const installTrigger = useInstallTrigger("confirmation");

  // Second (and last) chance to offer the install tutorial this session —
  // right after a real purchase intent, the highest-motivation moment.
  useEffect(() => {
    installTrigger.fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
      <CheckCircle2 className="h-14 w-14" style={{ color: "var(--snm-success)" }} />
      <h1 className="ios-title1 font-bold">Order placed!</h1>
      <p className="ios-headline font-semibold snm-num">{orderNumber}</p>
      <p className="ios-subhead max-w-xs" style={{ color: "var(--muted-foreground)" }}>
        We&apos;ll be in touch shortly to confirm and arrange delivery.
      </p>
      <Link
        href="/"
        className="snm-pressable mt-4 px-6 py-3 rounded-xl font-semibold"
        style={{ background: "var(--foreground)", color: "var(--background)" }}
      >
        Continue shopping
      </Link>

      <InstallSheet open={installTrigger.open} onClose={installTrigger.close} />
    </main>
  );
}
