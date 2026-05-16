"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Users, Warehouse, Pencil, Trash2, Star,
  UserCheck, UserCog, Truck, Plus, ShieldCheck,
  Tag, ChevronRight, ChevronDown, X,
} from "lucide-react";
import {
  listGodowns, createGodown, updateGodown, deleteGodown,
  listUsers, updateUser, deleteUser, inviteUser,
  type GodownRow, type GodownInput, type UserProfileRow, type UserRole,
  type PriceTier,
} from "@/lib/queries/masters";
import { getCurrentUserRole, listSkusFlat, type SkuFullRow } from "@/lib/queries/products";
import { supabase } from "@/lib/supabase";
import {
  listPriceLists, createPriceList, deletePriceList,
  listPriceListItems, upsertPriceListItem, deletePriceListItem,
  type PriceListRow, type PriceListItemRow,
} from "@/lib/queries/pricelists";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin", manager: "Manager", staff: "Staff",
};
const ROLE_LABEL_FULL: Record<UserRole, string> = {
  admin: "Administrator", manager: "Manager", staff: "Delivery Staff",
};
const ROLE_DESC: Record<UserRole, string> = {
  admin: "Full access. Can delete master data and manage users.",
  manager: "Full operational access. Cannot manage users.",
  staff: "Can only see and update their own deliveries.",
};
const ROLE_ICON: Record<UserRole, React.ElementType> = {
  admin: UserCheck, manager: UserCog, staff: Truck,
};
const ROLE_COLOR: Record<UserRole, string> = {
  admin: "var(--foreground)",
  manager: "var(--snm-brand)",
  staff: "var(--muted-foreground)",
};

export default function SettingsPage() {
  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);

  const [inviteSheet, setInviteSheet] = useState(false);
  const [editUserSheet, setEditUserSheet] = useState<UserProfileRow | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfileRow | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [godownSheet, setGodownSheet] = useState<{ open: boolean; editing?: GodownRow }>({ open: false });
  const [deleteGodownTarget, setDeleteGodownTarget] = useState<GodownRow | null>(null);
  const [deletingGodown, setDeletingGodown] = useState(false);
  const [priceLists, setPriceLists] = useState<PriceListRow[]>([]);
  const [skus, setSkus] = useState<SkuFullRow[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [u, g, pl, sk] = await Promise.all([listUsers(), listGodowns(), listPriceLists(), listSkusFlat()]);
      setUsers(u);
      setGodowns(g);
      setPriceLists(pl);
      setSkus(sk);
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
      toast.success("Default godown updated");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">

      {/* Page header */}
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>System</p>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>Settings</h1>
      </div>

      {/* ── Team Members ──────────────────────────────────────── */}
      <section
        className="rounded-2xl p-5"
        style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--glass-border)" }}
      >
        {/* Section header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
              <Users className="h-4 w-4" style={{ color: "var(--foreground)" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Team Members</h2>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{users.length} {users.length === 1 ? "member" : "members"}</p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => setInviteSheet(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-opacity hover:opacity-80 active:scale-95"
              style={{ background: "var(--foreground)", color: "var(--background)", minHeight: "36px" }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Member
            </button>
          )}
        </div>

        {/* Users list */}
        {!isAdmin ? (
          <div className="flex items-center gap-3 px-4 py-4 rounded-xl" style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
            <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Only administrators can manage team members.</p>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8">
            <Users className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--muted-foreground)", opacity: 0.4 }} />
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>No team members yet</p>
            <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>Add your first team member above</p>
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => {
              const isMe = u.id === myId;
              const Icon = ROLE_ICON[u.role];
              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
                >
                  {/* Avatar + info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
                      style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--foreground)" }}
                    >
                      {(u.full_name ?? u.email ?? "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                          {u.full_name ?? "—"}
                        </p>
                        {isMe && (
                          <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md shrink-0"
                            style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--muted-foreground)" }}>
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-xs truncate" style={{ color: "var(--muted-foreground)" }}>{u.email ?? "—"}</p>
                    </div>
                  </div>

                  {/* Role + actions */}
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                      style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
                      <Icon className="h-3 w-3 shrink-0" style={{ color: ROLE_COLOR[u.role] }} />
                      <span className="text-[11px] font-semibold hidden sm:block" style={{ color: "var(--foreground)" }}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    </div>
                    {!isMe && (
                      <>
                        <button
                          onClick={() => setEditUserSheet(u)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-accent"
                          style={{ color: "var(--muted-foreground)" }}
                          aria-label="Edit user"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteUserTarget(u)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                          style={{ color: "var(--muted-foreground)" }}
                          onMouseEnter={e => (e.currentTarget.style.color = "var(--snm-error)")}
                          onMouseLeave={e => (e.currentTarget.style.color = "var(--muted-foreground)")}
                          aria-label="Remove user"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Godowns ───────────────────────────────────────────── */}
      <section
        className="rounded-2xl p-5"
        style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--glass-border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
              <Warehouse className="h-4 w-4" style={{ color: "var(--foreground)" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Godowns</h2>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{godowns.length} {godowns.length === 1 ? "warehouse" : "warehouses"}</p>
            </div>
          </div>
          <button
            onClick={() => setGodownSheet({ open: true })}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-opacity hover:opacity-80 active:scale-95"
            style={{ background: "var(--foreground)", color: "var(--background)", minHeight: "36px" }}
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        {godowns.length === 0 ? (
          <div className="text-center py-8">
            <Warehouse className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--muted-foreground)", opacity: 0.4 }} />
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>No godowns yet</p>
            <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>Add the warehouses where you keep stock</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {godowns.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between p-4 rounded-xl"
                style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: g.is_default ? "color-mix(in srgb, var(--snm-brand) 15%, transparent)" : "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
                    <Warehouse className="h-3.5 w-3.5" style={{ color: g.is_default ? "var(--snm-brand)" : "var(--muted-foreground)" }} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{g.name}</p>
                      {g.is_default && (
                        <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md shrink-0"
                          style={{ background: "color-mix(in srgb, var(--snm-brand) 15%, transparent)", color: "var(--snm-brand)" }}>
                          Default
                        </span>
                      )}
                    </div>
                    {g.location && <p className="text-xs truncate" style={{ color: "var(--muted-foreground)" }}>{g.location}</p>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  {!g.is_default && (
                    <button
                      onClick={() => setDefaultGodown(g.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-accent"
                      style={{ color: "var(--muted-foreground)" }}
                      title="Set as default"
                      aria-label="Set as default godown"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setGodownSheet({ open: true, editing: g })}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-accent"
                    style={{ color: "var(--muted-foreground)" }}
                    aria-label="Edit godown"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => setDeleteGodownTarget(g)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                      style={{ color: "var(--muted-foreground)" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "var(--snm-error)")}
                      onMouseLeave={e => (e.currentTarget.style.color = "var(--muted-foreground)")}
                      aria-label="Delete godown"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Price Lists ──────────────────────────────────────── */}
      {isAdmin && (
        <PriceListsSection
          priceLists={priceLists}
          skus={skus}
          onChanged={load}
        />
      )}

      {/* ── Sheets ─────────────────────────────────────────────── */}
      {inviteSheet && (
        <InviteSheet onClose={() => setInviteSheet(false)} onDone={() => { setInviteSheet(false); load(); }} />
      )}
      {editUserSheet && (
        <EditUserSheet user={editUserSheet} onClose={() => setEditUserSheet(null)} onDone={() => { setEditUserSheet(null); load(); }} />
      )}
      {deleteUserTarget && (
        <ConfirmSheet
          title="Remove team member?"
          body={`${deleteUserTarget.full_name ?? deleteUserTarget.email} will immediately lose all access.`}
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
              toast.success("Godown deleted");
              setDeleteGodownTarget(null); load();
            } catch (e) { toast.error((e as Error).message); }
            finally { setDeletingGodown(false); }
          }}
        />
      )}
    </div>
  );
}

/* ── Sheet wrapper ─────────────────────────────────────────────────────── */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="w-full p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: "20px 20px 0 0", border: "1px solid var(--glass-border)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "var(--glass-border)" }} />
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-lg leading-none transition-opacity hover:opacity-70"
            style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)" }}
          >×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SheetInput({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
        {label}{required && " *"}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-xl px-4 py-3 text-sm outline-none transition-all focus:ring-1"
  + " bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]"
  + " text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
  + " border border-[var(--glass-border)] focus:ring-[var(--foreground)]";

function SheetActions({ onCancel, onConfirm, disabled, label }: {
  onCancel: () => void; onConfirm: () => void; disabled?: boolean; label: string;
}) {
  return (
    <div className="flex gap-3 mt-6">
      <button
        onClick={onCancel}
        className="flex-1 py-3 rounded-full text-sm font-medium transition-opacity hover:opacity-70"
        style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)" }}
      >Cancel</button>
      <button
        onClick={onConfirm}
        disabled={disabled}
        className="flex-[2] py-3 rounded-full text-xs font-bold uppercase tracking-widest transition-opacity hover:opacity-85 active:scale-95 disabled:opacity-40"
        style={{ background: "var(--foreground)", color: "var(--background)" }}
      >{label}</button>
    </div>
  );
}

function ConfirmSheet({ title, body, danger, loading, onCancel, onConfirm }: {
  title: string; body: string; danger?: boolean; loading?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-sm p-6 rounded-3xl" style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", border: "1px solid var(--glass-border)" }}>
        <p className="text-base font-semibold mb-2" style={{ color: "var(--foreground)" }}>{title}</p>
        <p className="text-sm mb-6" style={{ color: "var(--muted-foreground)" }}>{body}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-full text-sm font-medium transition-opacity hover:opacity-70"
            style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)" }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-3 rounded-full text-sm font-bold disabled:opacity-40 active:scale-95 transition-all"
            style={danger
              ? { background: "color-mix(in srgb, var(--snm-error) 12%, transparent)", color: "var(--snm-error)", border: "1px solid color-mix(in srgb, var(--snm-error) 30%, transparent)" }
              : { background: "var(--foreground)", color: "var(--background)" }
            }
          >{loading ? "Working…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Invite Sheet ──────────────────────────────────────────────────────── */
function InviteSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [tempPassword, setTempPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = !!email.trim() && !!fullName.trim() && tempPassword.length >= 6;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await inviteUser(email.trim().toLowerCase(), fullName.trim(), role, tempPassword);
      toast.success(`${fullName.trim()} added successfully`);
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title="Add Team Member" onClose={onClose}>
      <SheetInput label="Full Name" required>
        <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Ahmed Hassan" className={inputCls} />
      </SheetInput>
      <SheetInput label="Email Address" required>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ahmed@example.com" className={inputCls} />
      </SheetInput>
      <SheetInput label="Role" required>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputCls}>
          <option value="manager">Manager — Full operational access</option>
          <option value="staff">Delivery Staff — Deliveries only</option>
        </select>
      </SheetInput>
      <SheetInput label="Temporary Password" required>
        <input
          type="text"
          value={tempPassword}
          onChange={(e) => setTempPassword(e.target.value)}
          placeholder="Min 6 characters"
          className={inputCls}
        />
        <p className="text-xs mt-1.5" style={{ color: "var(--muted-foreground)" }}>
          Share this with the user. They can change it later via Forgot password.
        </p>
      </SheetInput>
      <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !canSave} label={saving ? "Adding…" : "ADD MEMBER"} />
    </Sheet>
  );
}

/* ── Edit User Sheet ───────────────────────────────────────────────────── */
function EditUserSheet({ user, onClose, onDone }: { user: UserProfileRow; onClose: () => void; onDone: () => void }) {
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [role, setRole] = useState<UserRole>(user.role);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      await updateUser(user.id, fullName.trim(), role);
      toast.success("Member updated");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title="Edit Member" onClose={onClose}>
      <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>{user.email}</p>
      <SheetInput label="Full Name" required>
        <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
      </SheetInput>
      {user.role !== "admin" && (
        <SheetInput label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputCls}>
            <option value="manager">Manager — Full operational access</option>
            <option value="staff">Delivery Staff — Deliveries only</option>
          </select>
          <p className="text-xs mt-1.5" style={{ color: "var(--muted-foreground)" }}>{ROLE_DESC[role]}</p>
        </SheetInput>
      )}
      <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !fullName.trim()} label={saving ? "Saving…" : "SAVE CHANGES"} />
    </Sheet>
  );
}

/* ── Godown Sheet ──────────────────────────────────────────────────────── */
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
      toast.success(editing ? "Godown updated" : "Godown created");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title={editing ? "Edit Godown" : "New Godown"} onClose={onClose}>
      <SheetInput label="Name" required>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" className={inputCls} />
      </SheetInput>
      <SheetInput label="Location">
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional address" className={inputCls} />
      </SheetInput>
      <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !name.trim()} label={saving ? "Saving…" : editing ? "SAVE CHANGES" : "CREATE GODOWN"} />
    </Sheet>
  );
}

/* ── Price Lists Section ───────────────────────────────────────────────── */

const TIERS: { value: PriceTier; label: string; color: string }[] = [
  { value: "retail",    label: "Retail",    color: "var(--muted-foreground)" },
  { value: "wholesale", label: "Wholesale", color: "var(--snm-warning)" },
  { value: "vip",       label: "VIP",       color: "var(--snm-brand)" },
  { value: "promo",     label: "Promo",     color: "var(--snm-success)" },
];

function PriceListsSection({ priceLists, skus, onChanged }: {
  priceLists: PriceListRow[];
  skus: SkuFullRow[];
  onChanged: () => void;
}) {
  const [openList, setOpenList]       = useState<PriceListRow | null>(null);
  const [newListTier, setNewListTier] = useState<PriceTier | null>(null);
  const [deleting, setDeleting]       = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete price list "${name}"? All prices in it will be lost.`)) return;
    setDeleting(id);
    try {
      await deletePriceList(id);
      toast.success("Price list deleted");
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(null); }
  }

  const byTier = useMemo(() => {
    const m = new Map<PriceTier, PriceListRow[]>();
    for (const t of TIERS) m.set(t.value, []);
    for (const pl of priceLists) {
      m.get(pl.tier as PriceTier)?.push(pl);
    }
    return m;
  }, [priceLists]);

  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: "var(--glass-1)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--glass-border)" }}
    >
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
          <Tag className="h-4 w-4" style={{ color: "var(--foreground)" }} />
        </div>
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Price Lists</h2>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Tier-specific selling prices per SKU — auto-applied at order entry
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {TIERS.map(({ value: tier, label, color }) => {
          const lists = byTier.get(tier) ?? [];
          return (
            <div key={tier}>
              {/* Tier header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                    style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
                  >
                    {label.toUpperCase()}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                    {lists.length} list{lists.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  onClick={() => setNewListTier(tier)}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 active:scale-95"
                  style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
                >
                  <Plus className="h-3 w-3" /> New list
                </button>
              </div>

              {/* Lists */}
              {lists.length === 0 ? (
                <p className="text-xs px-1 py-2" style={{ color: "var(--muted-foreground)" }}>
                  No price list yet — all {label.toLowerCase()} customers use SKU default prices.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {lists.map((pl) => (
                    <div
                      key={pl.id}
                      className="flex items-center justify-between px-4 py-3 rounded-xl"
                      style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}
                    >
                      <button
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                        onClick={() => setOpenList(pl)}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{pl.name}</p>
                          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                            Effective {new Date(pl.effective_from + "T00:00:00").toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
                            {pl.notes ? ` · ${pl.notes}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
                      </button>
                      <button
                        onClick={() => handleDelete(pl.id, pl.name)}
                        disabled={deleting === pl.id}
                        className="ml-3 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                        style={{ color: "var(--muted-foreground)" }}
                        onMouseEnter={e => (e.currentTarget.style.color = "var(--snm-error)")}
                        onMouseLeave={e => (e.currentTarget.style.color = "var(--muted-foreground)")}
                      >
                        {deleting === pl.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New list sheet */}
      {newListTier && (
        <NewPriceListSheet
          tier={newListTier}
          onClose={() => setNewListTier(null)}
          onDone={() => { setNewListTier(null); onChanged(); }}
        />
      )}

      {/* Edit items sheet */}
      {openList && (
        <PriceListItemsSheet
          priceList={openList}
          skus={skus}
          onClose={() => setOpenList(null)}
          onDone={() => { setOpenList(null); onChanged(); }}
        />
      )}
    </section>
  );
}

/* ── New Price List sheet ──────────────────────────────────────────────── */
function NewPriceListSheet({ tier, onClose, onDone }: {
  tier: PriceTier; onClose: () => void; onDone: () => void;
}) {
  const t = TIERS.find((x) => x.value === tier)!;
  const [name, setName] = useState(`${t.label} Price List`);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createPriceList({ name: name.trim(), tier, effective_from: effectiveFrom, notes: notes.trim() || null });
      toast.success("Price list created");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title={`New ${t.label} Price List`} onClose={onClose}>
      <SheetInput label="Name" required>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </SheetInput>
      <SheetInput label="Effective From" required>
        <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={inputCls} />
        <p className="text-xs mt-1.5" style={{ color: "var(--muted-foreground)" }}>
          This list applies to orders on or after this date. Old lists remain intact.
        </p>
      </SheetInput>
      <SheetInput label="Notes (optional)">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Ramadan 2025 promo" className={inputCls} />
      </SheetInput>
      <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !name.trim()} label={saving ? "Creating…" : "CREATE LIST"} />
    </Sheet>
  );
}

/* ── Price List Items sheet ────────────────────────────────────────────── */
function PriceListItemsSheet({ priceList, skus, onClose, onDone }: {
  priceList: PriceListRow;
  skus: SkuFullRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = TIERS.find((x) => x.value === priceList.tier)!;
  const [items, setItems]     = useState<PriceListItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [addSkuId, setAddSkuId] = useState("");
  const [addSheet, setAddSheet] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function loadItems() {
    setLoading(true);
    try { setItems(await listPriceListItems(priceList.id)); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadItems(); }, [priceList.id]);

  const setSkuIds = useMemo(() => new Set(items.map((i) => i.sku_id)), [items]);

  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase();
    return skus
      .filter((s) => s.is_active && !setSkuIds.has(s.id))
      .filter((s) => !term || [s.brand_name, s.model_name, s.variant_display ?? "", s.internal_code ?? ""].join(" ").toLowerCase().includes(term))
      .slice(0, 40);
  }, [skus, setSkuIds, search]);

  async function handleDelete(itemId: string) {
    setDeleting(itemId);
    try {
      await deletePriceListItem(itemId);
      toast.success("Removed");
      loadItems();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--background)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--glass-border-lo)" }}>
        <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}>
          <X className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-widest" style={{ color: t.color }}>{t.label}</p>
          <h2 className="text-base font-semibold truncate" style={{ color: "var(--foreground)" }}>{priceList.name}</h2>
        </div>
        <button
          onClick={() => setAddSheet(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shrink-0"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          <Plus className="h-3.5 w-3.5" /> Add SKU
        </button>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted-foreground)" }} /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <Tag className="h-8 w-8 mx-auto mb-3 opacity-30" style={{ color: "var(--muted-foreground)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>No SKUs added yet</p>
            <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>Tap "Add SKU" to set prices for this tier</p>
          </div>
        ) : (
          items.map((item) => {
            const sku = skus.find((s) => s.id === item.sku_id);
            return (
              <div key={item.id} className="rounded-2xl p-4" style={{ background: "var(--glass-1)", border: "1px solid var(--glass-border-lo)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                      {sku ? `${sku.brand_name} › ${sku.model_name}` : item.sku_id}
                    </p>
                    {sku?.variant_display && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{sku.variant_display}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={deleting === item.id}
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ color: "var(--muted-foreground)" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "var(--snm-error)")}
                    onMouseLeave={e => (e.currentTarget.style.color = "var(--muted-foreground)")}
                  >
                    {deleting === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: "/ piece",  value: item.price_per_piece_mvr },
                    { label: "/ pack",   value: item.price_per_pack_mvr },
                    { label: "/ carton", value: item.price_per_carton_mvr },
                  ].map((p) => (
                    <div key={p.label} className="rounded-xl px-3 py-2 text-center" style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--muted-foreground)" }}>{p.label}</p>
                      <p className="text-sm font-semibold" style={{ color: t.color }}>MVR {Number(p.value).toFixed(2)}</p>
                    </div>
                  ))}
                </div>
                {item.margin_pct != null && (
                  <p className="text-[11px] mt-2" style={{ color: "var(--muted-foreground)" }}>
                    Margin: {Number(item.margin_pct).toFixed(1)}%
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add SKU sheet */}
      {addSheet && (
        <AddSkuToListSheet
          priceListId={priceList.id}
          skus={filteredSkus}
          search={search}
          onSearch={setSearch}
          selectedSkuId={addSkuId}
          onSelectSku={setAddSkuId}
          onClose={() => { setAddSheet(false); setAddSkuId(""); setSearch(""); }}
          onSaved={() => { setAddSheet(false); setAddSkuId(""); setSearch(""); loadItems(); }}
        />
      )}
    </div>
  );
}

/* ── Add SKU to price list sheet ───────────────────────────────────────── */
function AddSkuToListSheet({ priceListId, skus, search, onSearch, selectedSkuId, onSelectSku, onClose, onSaved }: {
  priceListId:   string;
  skus:          SkuFullRow[];
  search:        string;
  onSearch:      (s: string) => void;
  selectedSkuId: string;
  onSelectSku:   (id: string) => void;
  onClose:       () => void;
  onSaved:       () => void;
}) {
  const sku = skus.find((s) => s.id === selectedSkuId) ?? null;

  const [piece,   setPiece]   = useState("");
  const [pack,    setPack]    = useState("");
  const [carton,  setCarton]  = useState("");
  const [saving,  setSaving]  = useState(false);

  // Auto-fill pack/carton when piece changes
  useEffect(() => {
    if (!sku || !piece) return;
    const p = parseFloat(piece);
    if (isNaN(p) || p <= 0) return;
    setPack((p * sku.pcs_per_pack).toFixed(2));
    setCarton((p * sku.pcs_per_pack * sku.packs_per_carton).toFixed(2));
  }, [piece, sku]);

  // Auto-fill margin hint
  const marginHint = useMemo(() => {
    if (!sku || !piece) return null;
    const p = parseFloat(piece);
    const landed = sku.landed_per_piece_mvr ?? null;
    if (!landed || isNaN(p) || p <= 0) return null;
    return ((p - landed) / p * 100).toFixed(1);
  }, [piece, sku]);

  async function save() {
    if (!selectedSkuId || !piece || !pack || !carton) return;
    const p = parseFloat(piece); const pk = parseFloat(pack); const c = parseFloat(carton);
    if (isNaN(p) || isNaN(pk) || isNaN(c) || p <= 0) return;
    setSaving(true);
    try {
      await upsertPriceListItem({
        price_list_id: priceListId,
        sku_id: selectedSkuId,
        price_per_piece_mvr:   p,
        price_per_pack_mvr:    pk,
        price_per_carton_mvr:  c,
        margin_pct: marginHint != null ? parseFloat(marginHint) : null,
      });
      toast.success("Price saved");
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const canSave = !!selectedSkuId && !!piece && !!pack && !!carton && parseFloat(piece) > 0;

  return (
    <Sheet title="Add SKU Price" onClose={onClose}>
      {!selectedSkuId ? (
        <>
          <input
            autoFocus
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search brand, SKU, code…"
            className={inputCls + " mb-3"}
          />
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--glass-border-lo)", maxHeight: 260, overflowY: "auto" }}>
            {skus.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: "var(--muted-foreground)" }}>
                {search ? "No matches" : "All active SKUs already have prices in this list"}
              </p>
            ) : skus.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelectSku(s.id)}
                className="w-full text-left px-4 py-3 flex flex-col transition-colors hover:bg-accent"
                style={{ borderBottom: "1px solid var(--glass-border-lo)", background: "transparent" }}
              >
                <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                  {s.brand_name} › {s.model_name}
                  {s.variant_display ? <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}> · {s.variant_display}</span> : null}
                </p>
                {s.landed_per_piece_mvr != null && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    Landed MVR {Number(s.landed_per_piece_mvr).toFixed(3)}/pc
                  </p>
                )}
              </button>
            ))}
          </div>
        </>
      ) : sku ? (
        <>
          <div className="rounded-xl px-4 py-3 mb-4 flex items-center justify-between" style={{ background: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{sku.brand_name} › {sku.model_name}</p>
              {sku.variant_display && <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{sku.variant_display}</p>}
              {sku.landed_per_piece_mvr != null && (
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Landed: MVR {Number(sku.landed_per_piece_mvr).toFixed(3)}/pc
                </p>
              )}
            </div>
            <button onClick={() => onSelectSku("")} className="text-xs" style={{ color: "var(--muted-foreground)" }}>Change</button>
          </div>

          <div className="grid grid-cols-1 gap-3 mb-2">
            <SheetInput label="Price per piece (MVR) *">
              <input
                autoFocus
                type="number" inputMode="decimal" step="0.01" min="0.01"
                value={piece} onChange={(e) => setPiece(e.target.value)}
                placeholder="e.g. 12.50"
                className={inputCls}
              />
              {marginHint != null && (
                <p className="text-xs mt-1" style={{ color: parseFloat(marginHint) >= 20 ? "var(--snm-success)" : parseFloat(marginHint) >= 10 ? "var(--snm-warning)" : "var(--snm-error)" }}>
                  Gross margin: {marginHint}%
                </p>
              )}
            </SheetInput>
            <div className="grid grid-cols-2 gap-3">
              <SheetInput label="Price per pack">
                <input type="number" inputMode="decimal" step="0.01" value={pack} onChange={(e) => setPack(e.target.value)} className={inputCls} />
              </SheetInput>
              <SheetInput label="Price per carton">
                <input type="number" inputMode="decimal" step="0.01" value={carton} onChange={(e) => setCarton(e.target.value)} className={inputCls} />
              </SheetInput>
            </div>
          </div>

          <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !canSave} label={saving ? "Saving…" : "SAVE PRICE"} />
        </>
      ) : null}
    </Sheet>
  );
}
