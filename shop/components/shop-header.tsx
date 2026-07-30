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
      className="sticky top-0 z-40 flex items-center justify-between px-5 sm:px-8"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "16px",
        background: "color-mix(in srgb, var(--background) 92%, transparent)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--outline-variant)",
      }}
    >
      <Link href="/" className="flex items-center gap-2">
        <Image src="/saynomore-logo.png" alt="" width={26} height={26} priority className="h-[26px] w-[26px]" />
        <span className={`${instrumentSans.className} text-[17px] font-semibold tracking-tight`}>
          Say No More
        </span>
      </Link>
      <Link
        href="/cart"
        aria-label="Cart"
        className="snm-pressable relative flex h-10 w-10 items-center justify-center"
      >
        <ShoppingBag className="h-5 w-5" strokeWidth={1.5} />
        {totalItems > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {totalItems}
          </span>
        )}
      </Link>
    </header>
  );
}
