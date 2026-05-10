"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  listGodowns,
  createGodown,
  updateGodown,
  deleteGodown,
  listUsers,
  updateUser,
  deleteUser,
  inviteUser,
  type GodownRow,
  type GodownInput,
  type UserProfileRow,
  type UserRole,
} from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";
import { supabase } from "@/lib/supabase";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  staff: "Delivery Staff",
};
const ROLE_DESC: Record<UserRole, string> = {
  admin: "Full access. Can delete master data and manage users.",
  manager: "Full operational access. Cannot manage users.",
  staff: "Can only see and update their own deliveries.",
};
const ROLE_ICON: Record<UserRole, string> = {
  admin: "verified_user",
  manager: "manage_accounts",
  staff: "local_shipping",
};

const ALERT_TOGGLES = [
  { key: "low_stock", label: "Critical Low Stock", desc: "Alert when SKU drops below 5% threshold" },
  { key: "wholesale", label: "Wholesale Fulfillment", desc: "Push notification for high-value sales" },
  { key: "route_latency", label: "Driver Route Latency", desc: "Alert if shipment is >30m delayed" },
];

export default function SettingsPage() {
  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Record<string, boolean>>({
    low_stock: true, wholesale: true, route_latency: false,
  });

  const [inviteSheet, setInviteSheet] = useState(false);
  const [editUserSheet, setEditUserSheet] = useState<UserProfileRow | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfileRow | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [godownSheet, setGodownSheet] = useState<{ open: boolean; editing?: GodownRow }>({ open: false });
  const [deleteGodownTarget, setDeleteGodownTarget] = useState<GodownRow | null>(null);
  const [deletingGodown, setDeletingGodown] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [u, g] = await Promise.all([listUsers(), listGodowns()]);
      setUsers(u);
      setGodowns(g);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    getCurrentUserRole().then(setMyRole).catch(() => {});
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  const isAdmin = myRole === "admin";

  async function setDefaultGodown(id: string) {
    try {
      const current = godowns.find((g) => g.is_default);
      if (current && current.id !== id) await updateGodown(current.id, { is_default: false });
      await updateGodown(id, { is_default: true });
      toast.success("Default godown set");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">System</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Settings &amp; Security</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your enterprise architecture and security protocols.</p>
      </div>

      {/* Row 1: Roles (wide) + Integrations (narrow) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Roles & Permissions — 2/3 width on large */}
        <div className="glass p-6 lg:col-span-2">
          <div className="flex justify-between items-center mb-5">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-foreground text-xl">admin_panel_settings</span>
              <h2 className="text-lg font-semibold text-foreground">Roles &amp; Permissions</h2>
            </div>
            {isAdmin && (
              <button
                onClick={() => setInviteSheet(true)}
                className="text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all"
              >
                Invite
              </button>
            )}
          </div>

          {/* Role legend */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
            {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
              <div key={r} className="glass-flat p-3 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-muted-foreground" style={{ fontSize: 16 }}>{ROLE_ICON[r]}</span>
                  <span className="text-sm font-medium text-foreground">{ROLE_LABEL[r]}</span>
                </div>
                <p className="text-xs text-muted-foreground">{ROLE_DESC[r]}</p>
              </div>
            ))}
          </div>

          {/* Users list */}
          {!isAdmin ? (
            <p className="text-sm text-muted-foreground text-center py-5">Only administrators can manage users.</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-5">No team members yet.</p>
          ) : (
            <div className="space-y-1.5">
              {users.map((u) => {
                const isMe = u.id === myId;
                return (
                  <div
                    key={u.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl bg-muted/50"
                    style={{ borderLeft: u.role === "admin" ? "2px solid var(--foreground)" : "2px solid transparent" }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="material-symbols-outlined text-muted-foreground shrink-0" style={{ fontSize: 18 }}>{ROLE_ICON[u.role]}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground truncate">{u.full_name ?? "—"}</p>
                          {isMe && (
                            <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded bg-secondary text-secondary-foreground shrink-0">YOU</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{u.email ?? "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] font-medium uppercase tracking-widest px-2 py-1 rounded-full bg-secondary text-secondary-foreground hidden sm:block">
                        {ROLE_LABEL[u.role]}
                      </span>
                      {!isMe && (
                        <>
                          <button onClick={() => setEditUserSheet(u)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition">
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                          </button>
                          <button onClick={() => setDeleteUserTarget(u)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition">
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Integrations — 1/3 width on large */}
        <div className="glass p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <span className="material-symbols-outlined text-foreground text-xl">hub</span>
              <h2 className="text-lg font-semibold text-foreground">Integrations</h2>
            </div>
            <div className="glass-flat p-4 rounded-xl mb-4 relative overflow-hidden">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">WhatsApp API</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500" style={{ boxShadow: "0 0 6px rgba(74,222,128,0.6)" }} />
                  <span className="text-[10px] font-bold text-green-500">ACTIVE</span>
                </div>
              </div>
              <p className="text-sm text-foreground mb-1">Connected to <strong>+960 900...</strong></p>
              <p className="text-xs text-muted-foreground">Last handshake: 2m ago</p>
            </div>
          </div>
          <button className="w-full py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 active:scale-95 transition-all text-sm">
            Sync Handshake
          </button>
        </div>
      </div>

      {/* Row 2: Currency + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Currency Rates */}
        <div className="glass p-6">
          <div className="flex items-center gap-3 mb-6">
            <span className="material-symbols-outlined text-foreground text-xl">currency_exchange</span>
            <h2 className="text-lg font-semibold text-foreground">Base Currency Rates</h2>
          </div>
          <div className="space-y-5">
            {[
              { code: "IDR", name: "Indonesian Rupiah", rate: "15,642.00" },
              { code: "MVR", name: "Maldivian Rufiyaa", rate: "15.40" },
            ].map((c) => (
              <div key={c.code} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-foreground">
                    {c.code}
                  </div>
                  <span className="text-sm text-foreground">{c.name}</span>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-foreground">{c.rate}</p>
                  <p className="text-xs text-muted-foreground">Per 1 USD</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-5 border-t border-border">
            <p className="text-xs text-muted-foreground italic">Auto-refresh via exchange rate API every 6 hours.</p>
          </div>
        </div>

        {/* Stock & System Alerts */}
        <div className="glass p-6">
          <div className="flex items-center gap-3 mb-6">
            <span className="material-symbols-outlined text-foreground text-xl">notifications_active</span>
            <h2 className="text-lg font-semibold text-foreground">Stock &amp; System Alerts</h2>
          </div>
          <div className="space-y-5">
            {ALERT_TOGGLES.map((a) => (
              <div key={a.key} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{a.label}</p>
                  <p className="text-xs text-muted-foreground">{a.desc}</p>
                </div>
                <button
                  onClick={() => setAlerts((prev) => ({ ...prev, [a.key]: !prev[a.key] }))}
                  className="shrink-0 w-11 h-6 rounded-full relative transition-colors duration-200"
                  style={{ background: alerts[a.key] ? "var(--foreground)" : "var(--muted)" }}
                  aria-checked={alerts[a.key]}
                  role="switch"
                >
                  <div
                    className="absolute top-0.5 w-5 h-5 rounded-full transition-all duration-200"
                    style={{
                      background: alerts[a.key] ? "var(--primary-foreground)" : "var(--muted-foreground)",
                      left: alerts[a.key] ? "calc(100% - 22px)" : "2px",
                    }}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Godowns */}
      <div className="glass p-6">
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-foreground text-xl">warehouse</span>
            <h2 className="text-lg font-semibold text-foreground">Godowns / Warehouses</h2>
          </div>
          <button
            onClick={() => setGodownSheet({ open: true })}
            className="text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full bg-secondary text-secondary-foreground hover:bg-accent transition"
          >
            + New
          </button>
        </div>
        {godowns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No godowns yet. Add the warehouses where you keep stock.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {godowns.map((g) => (
              <div key={g.id} className="glass-flat p-4 rounded-xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="material-symbols-outlined text-muted-foreground shrink-0" style={{ fontSize: 18 }}>warehouse</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
                      {g.is_default && (
                        <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground shrink-0">Default</span>
                      )}
                    </div>
                    {g.location && <p className="text-xs text-muted-foreground truncate">{g.location}</p>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {!g.is_default && (
                    <button onClick={() => setDefaultGodown(g.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition" title="Set default">
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>star</span>
                    </button>
                  )}
                  <button onClick={() => setGodownSheet({ open: true, editing: g })} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition">
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>edit</span>
                  </button>
                  {isAdmin && (
                    <button onClick={() => setDeleteGodownTarget(g)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition">
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>delete</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Row 4: Enterprise Security */}
      <div className="glass p-8 relative overflow-hidden">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-xl">
            <div className="flex items-center gap-3 mb-3">
              <span className="material-symbols-outlined text-foreground" style={{ fontSize: 28 }}>shield_with_heart</span>
              <h2 className="text-lg font-semibold text-foreground">Enterprise Security Core</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              SayNoMore ERP utilizes end-to-end AES-256 encryption for all database handshakes. Your data integrity is monitored by real-time heuristic analysis.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0">
            <button className="px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 active:scale-95 transition-all text-sm">
              Download Audit Log
            </button>
            <button className="px-6 py-3 bg-secondary text-secondary-foreground font-bold rounded-xl hover:bg-accent active:scale-95 transition-all text-sm">
              View Access Keys
            </button>
          </div>
        </div>
        {/* Decorative glow */}
        <div className="absolute -right-16 -top-16 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: "var(--primary)", opacity: 0.04, filter: "blur(60px)" }} />
      </div>

      {/* ── Sheets ── */}
      {inviteSheet && (
        <InviteSheet onClose={() => setInviteSheet(false)} onDone={() => { setInviteSheet(false); load(); }} />
      )}
      {editUserSheet && (
        <EditUserSheet user={editUserSheet} onClose={() => setEditUserSheet(null)} onDone={() => { setEditUserSheet(null); load(); }} />
      )}
      {deleteUserTarget && (
        <ConfirmSheet
          title="Remove team member?"
          body={`${deleteUserTarget.full_name ?? deleteUserTarget.email} will lose all access immediately.`}
          danger loading={deletingUser}
          onCancel={() => setDeleteUserTarget(null)}
          onConfirm={async () => {
            setDeletingUser(true);
            try {
              await deleteUser(deleteUserTarget.id);
              toast.success(`${deleteUserTarget.full_name ?? "User"} removed`);
              setDeleteUserTarget(null); load();
            } catch (e) { toast.error((e as Error).message); }
            finally { setDeletingUser(false); }
          }}
        />
      )}
      {godownSheet.open && (
        <GodownSheet editing={godownSheet.editing} onClose={() => setGodownSheet({ open: false })} onDone={() => { setGodownSheet({ open: false }); load(); }} />
      )}
      {deleteGodownTarget && (
        <ConfirmSheet
          title="Delete godown?"
          body={`"${deleteGodownTarget.name}" will be permanently removed.`}
          danger loading={deletingGodown}
          onCancel={() => setDeleteGodownTarget(null)}
          onConfirm={async () => {
            setDeletingGodown(true);
            try {
              await deleteGodown(deleteGodownTarget.id);
              toast.success("Deleted");
              setDeleteGodownTarget(null); load();
            } catch (e) { toast.error((e as Error).message); }
            finally { setDeletingGodown(false); }
          }}
        />
      )}
    </div>
  );
}

/* ── Shared sheet wrapper ─────────────────────────────────────────────── */

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="glass-modal w-full rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto">
        <div className="w-10 h-1 rounded-full bg-border mx-auto mb-5" />
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition text-lg leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SheetInput({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        {label}{required && " *"}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full bg-muted border-0 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring outline-none";

function SheetActions({ onCancel, onConfirm, disabled, label }: {
  onCancel: () => void; onConfirm: () => void; disabled?: boolean; label: string;
}) {
  return (
    <div className="flex gap-3 mt-6">
      <button onClick={onCancel} className="flex-1 py-3 rounded-full bg-secondary text-secondary-foreground text-sm font-medium hover:bg-accent transition">Cancel</button>
      <button onClick={onConfirm} disabled={disabled} className="flex-[2] py-3 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all">
        {label}
      </button>
    </div>
  );
}

function ConfirmSheet({ title, body, danger, loading, onCancel, onConfirm }: {
  title: string; body: string; danger?: boolean; loading?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="glass-modal rounded-3xl p-6 w-full max-w-sm">
        <p className="text-base font-semibold text-foreground mb-2">{title}</p>
        <p className="text-sm text-muted-foreground mb-6">{body}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-full bg-secondary text-secondary-foreground text-sm font-medium hover:bg-accent transition">Cancel</button>
          <button
            onClick={onConfirm} disabled={loading}
            className={`flex-1 py-3 rounded-full text-sm font-bold disabled:opacity-50 active:scale-95 transition-all ${danger ? "bg-destructive/10 text-destructive" : "bg-primary text-primary-foreground"}`}
          >
            {loading ? "Working…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Invite Sheet ─────────────────────────────────────────────────────── */
function InviteSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!email.trim() || !fullName.trim()) return;
    setSaving(true);
    try {
      await inviteUser(email.trim().toLowerCase(), fullName.trim(), role);
      toast.success(`Invite sent to ${email.trim()}`);
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title="Invite Team Member" onClose={onClose}>
      <SheetInput label="Full Name" required>
        <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Ahmed Hassan" className={inputCls} />
      </SheetInput>
      <SheetInput label="Email Address" required>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ahmed@example.com" className={inputCls} />
      </SheetInput>
      <SheetInput label="Role" required>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputCls}>
          <option value="manager">Manager</option>
          <option value="staff">Delivery Staff</option>
        </select>
        <p className="text-xs text-muted-foreground mt-1.5">{ROLE_DESC[role]}</p>
      </SheetInput>
      <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !email.trim() || !fullName.trim()} label={saving ? "Sending…" : "SEND INVITE"} />
    </Sheet>
  );
}

/* ── Edit User Sheet ──────────────────────────────────────────────────── */
function EditUserSheet({ user, onClose, onDone }: { user: UserProfileRow; onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [role, setRole] = useState<UserRole>(user.role);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      await updateUser(user.id, fullName.trim(), role);
      toast.success("Updated");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title="Edit Team Member" onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-4">{user.email}</p>
      <SheetInput label="Full Name" required>
        <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
      </SheetInput>
      {user.role !== "admin" && (
        <SheetInput label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputCls}>
            <option value="manager">Manager</option>
            <option value="staff">Delivery Staff</option>
          </select>
          <p className="text-xs text-muted-foreground mt-1.5">{ROLE_DESC[role]}</p>
        </SheetInput>
      )}
      <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !fullName.trim()} label={saving ? "Saving…" : "SAVE CHANGES"} />
    </Sheet>
  );
}

/* ── Godown Sheet ─────────────────────────────────────────────────────── */
function GodownSheet({ editing, onClose, onDone }: { editing?: GodownRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    const payload: GodownInput = { name: name.trim(), location: location.trim() || null };
    setSaving(true);
    try {
      if (editing) await updateGodown(editing.id, payload);
      else await createGodown(payload);
      toast.success(editing ? "Saved" : "Godown created");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title={editing ? "Edit Godown" : "New Godown"} onClose={onClose}>
      <SheetInput label="Name" required>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" className={inputCls} />
      </SheetInput>
      <SheetInput label="Location / Address">
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" className={inputCls} />
      </SheetInput>
      <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !name.trim()} label={saving ? "Saving…" : editing ? "SAVE CHANGES" : "CREATE GODOWN"} />
    </Sheet>
  );
}
