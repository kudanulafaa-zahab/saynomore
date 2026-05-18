import {
  LayoutDashboard,
  Truck,
  Boxes,
  ShoppingCart,
  BarChart2,
  LineChart,
  Building2,
  Wallet,
  Tag,
  Package,
  MapPin,
  Warehouse,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
}

export const FULL_NAV: NavItem[] = [
  // Primary 5 tabs
  { href: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard, primary: true },
  { href: "/shipments",  label: "Shipments",  icon: Truck,           primary: true },
  { href: "/inventory",  label: "Inventory",  icon: Boxes,           primary: true },
  { href: "/sales",      label: "Sales",      icon: ShoppingCart,    primary: true },
  { href: "/financials", label: "Financials", icon: BarChart2,       primary: true },

  // Shipment sub-modules (overflow)
  { href: "/suppliers",  label: "Suppliers",  icon: Building2 },
  { href: "/expenses",   label: "Expenses",   icon: Wallet    },

  // Inventory sub-modules (overflow)
  { href: "/products",   label: "Products",   icon: Package   },
  { href: "/godowns",    label: "Godowns",    icon: Warehouse },
  { href: "/competitors",label: "Market",     icon: Tag       },
  { href: "/reports",    label: "Reports",    icon: LineChart  },

  // Sales sub-modules (overflow)
  { href: "/customers",  label: "Customers",  icon: UserRound },
  { href: "/dispatch",   label: "Dispatch",   icon: MapPin    },
];

// Staff (delivery): dedicated driver screen
export const STAFF_NAV: NavItem[] = [
  { href: "/deliveries", label: "My Deliveries", icon: MapPin, primary: true },
];

export function navForRole(role: string): NavItem[] {
  return role === "staff" ? STAFF_NAV : FULL_NAV;
}
