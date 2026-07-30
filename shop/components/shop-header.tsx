"use client";

import Link from "next/link";
import Image from "next/image";
import { Instrument_Sans } from "next/font/google";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/components/cart/cart-provider";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["600"],
});

export function ShopHeader() {
  const { totalItems } = useCart();

  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between px-4"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 12px)",
        paddingBottom: "12px",
        background: "color-mix(in srgb, var(--background) 85%, transparent)",
        backdropFilter: "blur(20px)",
        borderBottom: "0.5px solid var(--glass-border-lo)",
      }}
    >
      <Link href="/" className="flex items-center gap-2">
        <Image src="/saynomore-logo.png" alt="" width={28} height={28} priority className="h-7 w-7" />
        <span className={`${instrumentSans.className} text-[17px] font-semibold tracking-tight`}>
          Say No More
        </span>
      </Link>
      <Link
        href="/cart"
        aria-label="Cart"
        className="snm-pressable relative h-11 w-11 flex items-center justify-center rounded-full"
        style={{ background: "var(--glass-1)" }}
      >
        <ShoppingBag className="h-5 w-5" />
        {totalItems > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center text-[11px] font-bold"
            style={{ background: "var(--snm-error)", color: "#fff" }}
          >
            {totalItems}
          </span>
        )}
      </Link>
    </header>
  );
}
