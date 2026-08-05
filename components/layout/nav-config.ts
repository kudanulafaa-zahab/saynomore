import {
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
export type NavSection = "Core" | "Finance" | "Procurement" | "Catalogue" | "Operations";

/** Heading order in the menus. */
export const NAV_SECTIONS: NavSection[] = ["Core", "Finance", "Procurement", "Catalogue", "Operations"];

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

  // Finance & reporting (overflow — deliberate navigation)
  { href: "/financials", label: "Financials",  icon: BarChart2,   section: "Finance" },
  { href: "/reports",    label: "Reports",     icon: LineChart,   section: "Finance" },
  { href: "/pricelists", label: "Price Lists", icon: Tags,        section: "Finance" },
  { href: "/costing",    label: "Price Simulator", icon: Calculator, section: "Finance" },
  { href: "/expenses",   label: "Expenses",    icon: Wallet,      section: "Finance" },

  // Procurement
  { href: "/reorder",    label: "Reorder",    icon: ClipboardList, section: "Procurement" },
  { href: "/shipments",  label: "Shipments",  icon: Ship,          section: "Procurement" },
  { href: "/suppliers",  label: "Suppliers",  icon: Building2,     section: "Procurement" },

  // Catalogue
  { href: "/products",   label: "Products",   icon: Package,       section: "Catalogue" },
  { href: "/godowns",    label: "Godowns",    icon: Warehouse,     section: "Catalogue" },
  { href: "/stock-ops",  label: "Stock Ops",  icon: ArrowLeftRight, section: "Catalogue" },
  { href: "/competitors",label: "Market",     icon: Tag,           section: "Catalogue" },

  // Operations
  { href: "/customers",  label: "Customers",  icon: UserRound,     section: "Operations" },
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
