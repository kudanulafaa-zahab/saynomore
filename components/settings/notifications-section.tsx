"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, Bell, Loader2, Lock, Package, Truck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { subscribeToPush, isPushSubscribed } from "@/lib/push";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { haptic } from "@/lib/haptics";

// The three real notification classes in the app. 'delivery' is critical:
// members can't switch it off themselves — only an admin can (per user, from
// Team Members). Preference enforcement is server-side in send-push, so these
// toggles are the real gate, not a cosmetic one.
const CATEGORIES = [
  {
    id: "delivery",
    label: "Deliveries",
    desc: "Driver assignments and delivered orders",
    icon: Truck,
    critical: true,
  },
  {
    id: "money",
    label: "Money",
    desc: "Payments received, orders voided or deleted",
    icon: Banknote,
    critical: false,
  },
  {
    id: "stock",
    label: "Stock",
    desc: "Shipment margin summaries and the daily low-stock digest",
    icon: Package,
    critical: false,
  },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];
type PrefMap = Record<CategoryId, { admin_enabled: boolean; user_enabled: boolean }>;

const DEFAULT_PREFS: PrefMap = {
  delivery: { admin_enabled: true, user_enabled: true },
  money: { admin_enabled: true, user_enabled: true },
  stock: { admin_enabled: true, user_enabled: true },
};

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

// ── User-facing section (Settings) ──────────────────────────────────────────

export function NotificationsSection() {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [prefs, setPrefs] = useState<PrefMap>(DEFAULT_PREFS);
  const [savingCat, setSavingCat] = useState<CategoryId | null>(null);

  useEffect(() => {
    const ok = pushSupported();
    setSupported(ok);
    if (ok) {
      setPermission(Notification.permission);
      isPushSubscribed().then(setSubscribed).catch(() => {});
    }
    supabase
      .rpc("get_notification_prefs")
      .then(({ data }) => {
        if (!data) return;
        const next = { ...DEFAULT_PREFS };
        for (const row of data as { category: CategoryId; admin_enabled: boolean; user_enabled: boolean }[]) {
          if (row.category in next) {
            next[row.category] = { admin_enabled: row.admin_enabled, user_enabled: row.user_enabled };
          }
        }
        setPrefs(next);
      });
  }, []);

  async function enable() {
    setEnabling(true);
    try {
      const r = await subscribeToPush();
      if (r.ok) {
        haptic("success");
        toast.success("Notifications are on");
        setSubscribed(true);
        setPermission("granted");
      } else {
        haptic("error");
        toast.error(r.reason ?? "Could not enable notifications");
        if (pushSupported()) setPermission(Notification.permission);
      }
    } finally {
      setEnabling(false);
    }
  }

  async function toggle(cat: CategoryId, enabled: boolean) {
    const prev = prefs[cat];
    setPrefs((p) => ({ ...p, [cat]: { ...p[cat], user_enabled: enabled } }));
    setSavingCat(cat);
    haptic("light");
    const { error } = await supabase.rpc("set_my_notification_pref", {
      p_category: cat,
      p_enabled: enabled,
    });
    setSavingCat(null);
    if (error) {
      setPrefs((p) => ({ ...p, [cat]: prev }));
      haptic("error");
      toast.error(error.message);
    }
  }

  const deviceOn = supported && permission === "granted" && subscribed;

  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-1)",
        border: "0.5px solid var(--glass-border-lo)",
        boxShadow: "var(--glass-shadow), var(--glass-inner)",
      }}
    >
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
              Notifications
            </p>
            <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Alerts arrive even when the app is closed
            </p>
          </div>
          {deviceOn && (
            <span className="flex items-center gap-1.5 shrink-0">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: "var(--snm-success)" }}
              />
              <span className="ios-footnote font-semibold" style={{ color: "var(--snm-success-text, var(--snm-success))" }}>
                On for this device
              </span>
            </span>
          )}
        </div>

        {/* Device state — enable button / blocked hint / install hint */}
        {!supported && (
          <div
            className="rounded-xl px-4 py-3"
            style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              To get notifications on iPhone, add SayNoMore to your home screen
              and open it from that icon.
            </p>
          </div>
        )}
        {supported && permission === "denied" && (
          <div
            className="rounded-xl px-4 py-3"
            style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
              Notifications are blocked on this device. Turn them on in
              iOS Settings → SayNoMore → Notifications.
            </p>
          </div>
        )}
        {supported && permission !== "denied" && !deviceOn && (
          <button
            onClick={enable}
            disabled={enabling}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl ios-subhead font-semibold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {enabling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Turn on notifications
          </button>
        )}

        {/* Category toggles — account-wide, apply on every device */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "0.5px solid var(--glass-border-lo)" }}
        >
          {CATEGORIES.map((c, i) => {
            const pref = prefs[c.id];
            const Icon = c.icon;
            const adminOff = !pref.admin_enabled;
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{
                  background: "var(--glass-bg-1)",
                  borderTop: i > 0 ? "0.5px solid var(--glass-border-lo)" : undefined,
                  opacity: adminOff ? 0.55 : 1,
                }}
              >
                <span
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: "color-mix(in srgb, var(--foreground) 10%, transparent)",
                    color: "var(--foreground)",
                  }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
                    {c.label}
                  </p>
                  <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                    {adminOff ? "Turned off by your administrator" : c.desc}
                  </p>
                </div>
                {c.critical ? (
                  <span className="flex items-center gap-1 shrink-0" style={{ color: "var(--muted-foreground)" }}>
                    <Lock className="h-3.5 w-3.5" />
                    <span className="ios-footnote font-semibold">
                      {adminOff ? "Off" : "Always on"}
                    </span>
                  </span>
                ) : (
                  <Switch
                    checked={pref.user_enabled && !adminOff}
                    disabled={adminOff || savingCat === c.id}
                    onCheckedChange={(v) => toggle(c.id, v)}
                    aria-label={`${c.label} notifications`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
          Delivery alerts are critical and always stay on. Your choices apply on
          all your devices.
        </p>
      </div>
    </section>
  );
}

// ── Admin dialog (opened from Team Members) ─────────────────────────────────
// Same three categories, but editing admin_enabled — the master gate that
// overrides the member's own setting, delivery included.

export function AdminNotificationsDialog({
  userId,
  userName,
  onClose,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [prefs, setPrefs] = useState<PrefMap | null>(null);
  const [savingCat, setSavingCat] = useState<CategoryId | null>(null);

  useEffect(() => {
    supabase
      .rpc("get_notification_prefs", { p_user: userId })
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          onClose();
          return;
        }
        const next = { ...DEFAULT_PREFS };
        for (const row of (data ?? []) as { category: CategoryId; admin_enabled: boolean; user_enabled: boolean }[]) {
          if (row.category in next) {
            next[row.category] = { admin_enabled: row.admin_enabled, user_enabled: row.user_enabled };
          }
        }
        setPrefs(next);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function toggle(cat: CategoryId, enabled: boolean) {
    if (!prefs) return;
    const prev = prefs[cat];
    setPrefs((p) => (p ? { ...p, [cat]: { ...p[cat], admin_enabled: enabled } } : p));
    setSavingCat(cat);
    haptic("light");
    const { error } = await supabase.rpc("admin_set_notification_pref", {
      p_user: userId,
      p_category: cat,
      p_enabled: enabled,
    });
    setSavingCat(null);
    if (error) {
      setPrefs((p) => (p ? { ...p, [cat]: prev } : p));
      haptic("error");
      toast.error(error.message);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>Notifications for {userName}</DialogTitle>
          <DialogDescription>
            Choose which alerts this member receives. Off here overrides their
            own setting.
          </DialogDescription>
        </DialogHeader>
        {!prefs ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "0.5px solid var(--glass-border-lo)" }}
          >
            {CATEGORIES.map((c, i) => {
              const Icon = c.icon;
              const pref = prefs[c.id];
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{
                    background: "var(--glass-bg-1)",
                    borderTop: i > 0 ? "0.5px solid var(--glass-border-lo)" : undefined,
                  }}
                >
                  <span
                    className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: "color-mix(in srgb, var(--foreground) 10%, transparent)",
                      color: "var(--foreground)",
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
                      {c.label}
                    </p>
                    <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                      {c.critical ? "Critical — members can't turn this off themselves" : c.desc}
                    </p>
                  </div>
                  <Switch
                    checked={pref.admin_enabled}
                    disabled={savingCat === c.id}
                    onCheckedChange={(v) => toggle(c.id, v)}
                    aria-label={`${c.label} notifications for ${userName}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
