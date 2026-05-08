import {
  LayoutDashboard,
  Package,
  Truck,
  Boxes,
  ShoppingCart,
  Users,
  Wallet,
  FileBarChart2,
  Tag,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean; // shown in bottom tab bar
}

// Admin & Manager
// Primary (primary: true) = shown in bottom tab bar on mobile
// Everything else = in the "More" overflow sheet
export const FULL_NAV: NavItem[] = [
  { href: "/dashboard",       label: "Home",       icon: LayoutDashboard, primary: true },
  { href: "/sales",           label: "Sales",      icon: ShoppingCart,    primary: true },
  { href: "/inventory",       label: "Stock",      icon: Boxes,           primary: true },
  { href: "/products",        label: "Products",   icon: Package,         primary: true },
  { href: "/customers",       label: "Customers",  icon: Users,           primary: true },
  { href: "/shipments",       label: "Shipments",  icon: Truck },
  { href: "/suppliers",       label: "Suppliers",  icon: Users },
  { href: "/competitors",     label: "Pricing",    icon: Tag },
  { href: "/expenses",        label: "Expenses",   icon: Wallet },
  { href: "/reports",         label: "Reports",    icon: FileBarChart2 },
];

// Staff (delivery): one screen only
export const STAFF_NAV: NavItem[] = [
  { href: "/deliveries", label: "My Deliveries", icon: Truck, primary: true },
];

export function navForRole(role: string): NavItem[] {
  return role === "staff" ? STAFF_NAV : FULL_NAV;
}
