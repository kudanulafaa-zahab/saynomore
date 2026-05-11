import {
  LayoutDashboard,
  Truck,
  Boxes,
  ShoppingCart,
  BarChart2,
  Users,
  Wallet,
  Tag,
  Package,
  MapPin,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean; // shown in bottom tab bar
}

// 5-tab ERP architecture per UX Architecture Guide:
// Tab 1: Dashboard | Tab 2: Shipment | Tab 3: Inventory | Tab 4: Sales | Tab 5: Financials
// Sub-modules appear in the overflow "More" sheet on mobile, sidebar on desktop

export const FULL_NAV: NavItem[] = [
  // Primary 5 tabs
  { href: "/dashboard",   label: "Dashboard",  icon: LayoutDashboard, primary: true },
  { href: "/shipments",   label: "Shipment",   icon: Truck,           primary: true },
  { href: "/inventory",   label: "Inventory",  icon: Boxes,           primary: true },
  { href: "/sales",       label: "Sales",      icon: ShoppingCart,    primary: true },
  { href: "/financials",  label: "Financials", icon: BarChart2,       primary: true },

  // Shipment sub-modules (overflow)
  { href: "/suppliers",   label: "Vendors",    icon: Users },
  { href: "/expenses",    label: "Expenses",   icon: Wallet },

  // Inventory sub-modules (overflow)
  { href: "/products",    label: "Products",   icon: Package },
  { href: "/godowns",     label: "Godowns",    icon: Warehouse },
  { href: "/competitors", label: "Pricing",    icon: Tag },
  { href: "/reports",     label: "Trends",     icon: BarChart2 },

  // Sales sub-modules (overflow)
  { href: "/customers",   label: "Customers",  icon: Users },
  { href: "/dispatch",    label: "Dispatch",   icon: MapPin },
];

// Staff (delivery): dispatch screen only
export const STAFF_NAV: NavItem[] = [
  { href: "/dispatch", label: "My Deliveries", icon: MapPin, primary: true },
];

export function navForRole(role: string): NavItem[] {
  return role === "staff" ? STAFF_NAV : FULL_NAV;
}
