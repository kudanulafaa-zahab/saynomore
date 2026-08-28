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
  Settings,
  type LucideIcon,
} from "lucide-react";

/** The whole menu, as DATA. One list, read by the tab bar, the desktop
 *  sidebar and the in-page section switcher.
 *
 *  Never add a second list of hrefs anywhere. That has now caused the same
 *  class of bug twice: the Price Simulator once shipped built, routable and
 *  invisible because both menus kept their own hardcoded lists, and the
 *  section headings drifted from the items they were heading. Everything below
 *  — which tabs exist, what each tab opens, and which icon it wears — is
 *  DERIVED from this array. */

/* ── FIVE TABS, ONE JOB EACH ────────────────────────────────────────────────
 *
 * Ali, 2026-08-28: *"The app has so many modules sparsely thrown... No proper
 * navigation hierarchy. It's poorly designed."*
 *
 * He was right, and the measurement said why: TWENTY screens behind six
 * headings and a "More" sheet, with TEN separate doors onto the single
 * question "what should I charge?".
 *
 * The old headings — Core / Finance / Pricing / Procurement / Warehouse /
 * Master Data — are the names of MODULES. Ali does not work in modules; he
 * works in jobs, and the module a job lives in was his to remember.
 *
 * ── WHAT THE RESEARCH SETTLED ───────────────────────────────────────────────
 *
 *   Apple HIG          three to five tabs on iPhone, and NO overflow tab. A
 *                      "More" sheet is the pattern to avoid, not a way to fit
 *                      more in. It is gone.
 *   Mobile IA practice task-based beats module-based on a phone: short
 *                      sessions, drill down, minimise wrong choices.
 *   Tab labels         NOUNS, not verbs — a tab is a destination, never an
 *                      action. This killed the first draft's "Sell".
 *
 * ── THE RULES THIS FILE NOW ENFORCES ────────────────────────────────────────
 *
 *  1. A tab is a SECTION, and every screen belongs to exactly one.
 *  2. The FIRST item in a section is that tab's home — the screen it opens —
 *     and its icon is the tab's icon. Derived, so a separate SECTION_HOME map
 *     cannot drift from the items it points at.
 *  3. Nothing was deleted or renamed away. Twenty screens became twenty
 *     sections inside five tabs; every route, deep link and notification
 *     target still works.
 */
export type NavSection = "Today" | "Sales" | "Stock" | "Prices" | "Products";

/** Tab order, left to right. Most-used first, and the daily loop up front. */
export const NAV_SECTIONS: NavSection[] = ["Today", "Sales", "Stock", "Prices", "Products"];

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSection;
}

export const FULL_NAV: NavItem[] = [
  // ── TODAY — what needs doing, and how the business is doing ──────────────
  // Financials, Reports and Expenses are all "how did we do", which is one
  // job and was three headings. The daily worklist leads because it is the
  // only part that asks him to act.
  { href: "/dashboard",    label: "Worth doing", icon: LayoutDashboard, section: "Today" },
  { href: "/financials",   label: "Money",       icon: BarChart2,       section: "Today" },
  { href: "/reports",      label: "Reports",     icon: LineChart,       section: "Today" },
  { href: "/expenses",     label: "Expenses",    icon: Wallet,          section: "Today" },

  // ── SALES — an order through to the cash coming back ─────────────────────
  // Customers sits here because every reason to open a customer is a selling
  // reason: who to chase, what they last bought, what they owe.
  { href: "/sales",        label: "Orders",      icon: ShoppingCart,    section: "Sales" },
  { href: "/dispatch",     label: "Dispatch",    icon: MapPin,          section: "Sales" },
  { href: "/customers",    label: "Customers",   icon: UserRound,       section: "Sales" },

  // ── STOCK — what you have, where it is, what is coming ───────────────────
  // Reorder, Shipments and Suppliers are the buying end of the same question.
  // Splitting "Procurement" from "Warehouse" made him hold in his head which
  // half of the stock story a screen belonged to.
  { href: "/inventory",    label: "On hand",     icon: Boxes,           section: "Stock" },
  { href: "/godowns",      label: "Godowns",     icon: Warehouse,       section: "Stock" },
  { href: "/stock-ops",    label: "Stock ops",   icon: ArrowLeftRight,  section: "Stock" },
  { href: "/reorder",      label: "Reorder",     icon: ClipboardList,   section: "Stock" },
  { href: "/shipments",    label: "Shipments",   icon: Ship,            section: "Stock" },
  { href: "/suppliers",    label: "Suppliers",   icon: Building2,       section: "Stock" },

  // ── PRICES — one door onto what you charge ───────────────────────────────
  // THE CHANGE THAT MATTERS. "What should I charge for Merries L?" had ten
  // plausible answers and now has one tab. Margin Watch stays inside Money
  // and the after-arrival review stays on the shipment, because both are read
  // in the middle of another job; everything you would open ON PURPOSE to
  // decide a price is here.
  { href: "/pricelists",   label: "Price book",  icon: Tags,            section: "Prices" },
  { href: "/costing",      label: "Simulator",   icon: Calculator,      section: "Prices" },
  { href: "/competitors",  label: "Market",      icon: Tag,             section: "Prices" },

  // ── PRODUCTS — the catalogue, and the app itself ─────────────────────────
  // Settings is an ITEM now rather than a special case bolted to the bottom of
  // two menus. Two components had their own copy of that link.
  { href: "/products",     label: "Catalogue",   icon: Package,         section: "Products" },
  { href: "/product-card", label: "Product card",icon: FileText,        section: "Products" },
  { href: "/settings",     label: "Settings",    icon: Settings,        section: "Products" },
];

// Staff (delivery): one screen, and it is the whole job.
export const STAFF_NAV: NavItem[] = [
  { href: "/deliveries", label: "My Deliveries", icon: MapPin, section: "Sales" },
];

// Viewer: full read nav — no dispatch (action-only module with no read value)
export const VIEWER_NAV: NavItem[] = FULL_NAV.filter((i) => i.href !== "/dispatch");

export function navForRole(role: string): NavItem[] {
  if (role === "staff")  return STAFF_NAV;
  if (role === "viewer") return VIEWER_NAV;
  return FULL_NAV;
}

/** The screens inside one tab, in order. First is the tab's home. */
export function itemsInSection(items: NavItem[], section: NavSection): NavItem[] {
  return items.filter((i) => i.section === section);
}

/** The tabs a role actually sees: every section that has at least one screen,
 *  in NAV_SECTIONS order, each carrying the home screen and icon of its first
 *  item. DERIVED — there is no second table of tab destinations to fall out of
 *  step with the items. */
export function tabsForRole(role: string): { section: NavSection; href: string; icon: LucideIcon }[] {
  const items = navForRole(role);
  return NAV_SECTIONS
    .map((section) => {
      const inSection = itemsInSection(items, section);
      return inSection.length === 0
        ? null
        : { section, href: inSection[0].href, icon: inSection[0].icon };
    })
    .filter((t): t is { section: NavSection; href: string; icon: LucideIcon } => t !== null);
}

/** Which screen is open, and which tab it belongs to. A nested route
 *  (/sales/abc123) belongs to its parent's tab, so the tab bar stays lit while
 *  he is three screens deep in an order. */
export function activeItem(items: NavItem[], pathname: string): NavItem | null {
  // Longest href first: /product-card must win over /products for
  // /product-card, and /stock-ops over /stock.
  const byLength = [...items].sort((a, b) => b.href.length - a.href.length);
  return byLength.find((i) => pathname === i.href || pathname.startsWith(i.href + "/")) ?? null;
}
