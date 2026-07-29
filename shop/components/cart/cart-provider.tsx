"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { SellUnit } from "@/lib/queries/catalogue";

export interface CartLine {
  sku_id: string;
  uom: SellUnit;
  qty: number;
}

interface CartContextValue {
  lines: CartLine[];
  add: (sku_id: string, uom: SellUnit, qty: number) => void;
  setQty: (sku_id: string, uom: SellUnit, qty: number) => void;
  remove: (sku_id: string, uom: SellUnit) => void;
  clear: () => void;
  totalItems: number;
}

const CartContext = createContext<CartContextValue>({
  lines: [],
  add: () => {},
  setQty: () => {},
  remove: () => {},
  clear: () => {},
  totalItems: 0,
});

const STORAGE_KEY = "snm-shop-cart-v1";

function lineKey(sku_id: string, uom: SellUnit) {
  return `${sku_id}:${uom}`;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Read localStorage once on mount (client only — SSR has no cart).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {
      /* corrupt or blocked storage — start with an empty cart */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* storage full/blocked — cart still works for this tab session */
    }
  }, [lines, hydrated]);

  function add(sku_id: string, uom: SellUnit, qty: number) {
    setLines((prev) => {
      const key = lineKey(sku_id, uom);
      const existing = prev.find((l) => lineKey(l.sku_id, l.uom) === key);
      if (existing) {
        return prev.map((l) =>
          lineKey(l.sku_id, l.uom) === key ? { ...l, qty: l.qty + qty } : l,
        );
      }
      return [...prev, { sku_id, uom, qty }];
    });
  }

  function setQty(sku_id: string, uom: SellUnit, qty: number) {
    setLines((prev) => {
      if (qty <= 0) return prev.filter((l) => lineKey(l.sku_id, l.uom) !== lineKey(sku_id, uom));
      return prev.map((l) =>
        lineKey(l.sku_id, l.uom) === lineKey(sku_id, uom) ? { ...l, qty } : l,
      );
    });
  }

  function remove(sku_id: string, uom: SellUnit) {
    setLines((prev) => prev.filter((l) => lineKey(l.sku_id, l.uom) !== lineKey(sku_id, uom)));
  }

  function clear() {
    setLines([]);
  }

  const totalItems = lines.reduce((sum, l) => sum + l.qty, 0);

  return (
    <CartContext.Provider value={{ lines, add, setQty, remove, clear, totalItems }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
