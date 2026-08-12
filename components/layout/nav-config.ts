import {
  FileText,
  LayoutDashboard,
  Boxes,
  ShoppingCart,
  BarChart2,
  LineChart,
  Building2,
  Wallet,
  Tag,
  Tags,
  Package,
  MapPin,
  Warehouse,
  UserRound,
  Ship,
  ClipboardList,
  ArrowLeftRight,
  Calculator,
  type LucideIcon,
} from "lucide-react";

/** Menu grouping. This is DATA, not a comment.
 *
 *  The More sheet and the desktop sidebar used to each keep their own
 *  hardcoded list of which hrefs belong to which heading. Adding a page here
 *  therefore did nothing — /costing shipped, built fine, and was reachable
 *  only by typing the URL, because neither menu's list mentioned it. A nav
 *  entry that renders nowhere is worse than no nav entry: it looks done.
 *
 *  Both menus now derive their sections from `section` below, so a new page
 *  cannot be invisible. Never reintroduce a second list of hrefs. */
export type NavSection =
  | "Core"
  | "Finance"
  | "Pricing"
  | "Procurement"
  | "Warehouse"
  | "Master Data";

/** Heading order in the menus — most-used first.
 *
 *  REGROUPED 2026-08-11. The old headings were Core / Finance / Procurement /
 *  Catalogue / Operations, and three of them were filing things in the wrong
 *  drawer rather than merely labelling them oddly:
 *
 *  1. GODOWNS and STOCK OPS lived under "Catalogue", two headings away from
 *     Inventory. Stock Ops is transfers, write-offs and stock counts — the
 *     ledger door. Filing it beside Products meant anything to do with stock
 *     was split across two sections for no reason.
 *  2. MARKET (competitor prices, Promo Advisor) also lived under "Catalogue".
 *     It is pricing intelligence and belongs beside Price Lists and the Price
 *     Simulator, which are the other two screens about what to charge.
 *  3. "OPERATIONS" held exactly one item, Customers. A heading over a single
 *     row is noise.
 *
 *  The names are the standard ones on purpose — Procurement, Warehouse, Master
 *  Data are what an ERP calls these, and Ali (2026-08-10) asked for correct
 *  terms rather than paraphrases. Every heading now has a real category behind
 *  it, and each is self-evident from the rows underneath.
 *
 *  Nothing was hidden, removed or renamed at the ITEM level: every page is
 *  still one tap from the menu, under a heading that describes it. */
export const NAV_SECTIONS: NavSection[] = [
  "Core", "Finance", "Pricing", "Procurement", "Warehouse", "Master Data",
];

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSection;
  primary?: boolean;
}

export const FULL_NAV: NavItem[] = [
  // Primary 4 tab-bar items (daily habit loop)
  { href: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard, section: "Core", primary: true },
  { href: "/sales",      label: "Sales",      icon: ShoppingCart,    section: "Core", primary: true },
  { href: "/inventory",  label: "Inventory",  icon: Boxes,           section: "Core", primary: true },
  { href: "/dispatch",   label: "Dispatch",   icon: MapPin,          section: "Core", primary: true },

  // Finance — what happened, in money
  { href: "/financials", label: "Financials",  icon: BarChart2,   section: "Finance" },
  { href: "/reports",    label: "Reports",     icon: LineChart,   section: "Finance" },
  { href: "/pricelists", label: "Price Lists", icon: Tags,        section: "Pricing" },
  { href: "/costing",    label: "Price Simulator", icon: Calculator, section: "Pricing" },
  { href: "/expenses",   label: "Expenses",    icon: Wallet,      section: "Finance" },

  // Procurement — what to bring in
  { href: "/reorder",    label: "Reorder",    icon: ClipboardList, section: "Procurement" },
  { href: "/shipments",  label: "Shipments",  icon: Ship,          section: "Procurement" },
  { href: "/suppliers",  label: "Suppliers",  icon: Building2,     section: "Procurement" },

  // Pricing — what to charge
  { href: "/products",   label: "Products",   icon: Package,       section: "Master Data" },
  // The read-only fact sheet. Filed beside Products because that is where you
  // look for a product, but it is a different job: Products is where you EDIT
  // the catalogue, this is where you UNDERSTAND one item. Hard rule 8 — a page
  // not listed here is invisible even when built and routable.
  { href: "/product-card", label: "Product Card", icon: FileText,    section: "Master Data" },
  { href: "/godowns",    label: "Godowns",    icon: Warehouse,     section: "Warehouse" },
  { href: "/stock-ops",  label: "Stock Ops",  icon: ArrowLeftRight, section: "Warehouse" },
  { href: "/competitors",label: "Market",     icon: Tag,           section: "Pricing" },

  // Master Data — the records everything else refers to
  { href: "/customers",  label: "Customers",  icon: UserRound,     section: "Master Data" },
];

// Staff (delivery): dedicated driver screen
export const STAFF_NAV: NavItem[] = [
  { href: "/deliveries", label: "My Deliveries", icon: MapPin, section: "Core", primary: true },
];

// Viewer: full read nav — no dispatch (action-only module with no read value)
export const VIEWER_NAV: NavItem[] = FULL_NAV.filter((i) => i.href !== "/dispatch");

export function navForRole(role: string): NavItem[] {
  if (role === "staff")  return STAFF_NAV;
  if (role === "viewer") return VIEWER_NAV;
  return FULL_NAV;
}
