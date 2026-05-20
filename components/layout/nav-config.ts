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
  Tags,
  Package,
  MapPin,
  Warehouse,
  UserRound,
  Ship,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
}

export const FULL_NAV: NavItem[] = [
  // Primary 4 tab-bar items (daily habit loop)
  { href: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard, primary: true },
  { href: "/sales",      label: "Sales",      icon: ShoppingCart,    primary: true },
  { href: "/inventory",  label: "Inventory",  icon: Boxes,           primary: true },
  { href: "/dispatch",   label: "Dispatch",   icon: MapPin,          primary: true },

  // Finance & reporting (overflow — deliberate navigation)
  { href: "/financials", label: "Financials",  icon: BarChart2   },
  { href: "/reports",    label: "Reports",     icon: LineChart   },
  { href: "/pricelists", label: "Price Lists", icon: Tags        },
  { href: "/expenses",   label: "Expenses",    icon: Wallet      },

  // Procurement
  { href: "/shipments",  label: "Shipments",  icon: Ship        },
  { href: "/suppliers",  label: "Suppliers",  icon: Building2   },

  // Catalogue
  { href: "/products",   label: "Products",   icon: Package     },
  { href: "/godowns",    label: "Godowns",    icon: Warehouse   },
  { href: "/competitors",label: "Market",     icon: Tag         },

  // Operations
  { href: "/customers",  label: "Customers",  icon: UserRound   },
];

// Staff (delivery): dedicated driver screen
export const STAFF_NAV: NavItem[] = [
  { href: "/deliveries", label: "My Deliveries", icon: MapPin, primary: true },
];

export function navForRole(role: string): NavItem[] {
  return role === "staff" ? STAFF_NAV : FULL_NAV;
}
