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
  // true when the price-list form is open → collapse Team Members + Godowns
  const [pricingFocused, setPricingFocused] = useState(false);

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
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
          transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {/* Section header — always visible */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
              <Users className="h-4 w-4" style={{ color: "var(--foreground)" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Team Members</h2>
              {!pricingFocused && (
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{users.length} {users.length === 1 ? "member" : "members"}</p>
              )}
              {pricingFocused && (
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{users.length} {users.length === 1 ? "member" : "members"} · tap to expand</p>
              )}
            </div>
          </div>
          {isAdmin && !pricingFocused && (
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

        {/* Users list — collapses when pricingFocused */}
        <div
          style={{
            maxHeight: pricingFocused ? 0 : "600px",
            overflow: "hidden",
            transition: "max-height 0.35s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          <div className="px-5 pb-5">
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
          </div>
        </div>
      </section>

      {/* ── Godowns ───────────────────────────────────────────── */}
      <section
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
          transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {/* Section header — always visible */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
              <Warehouse className="h-4 w-4" style={{ color: "var(--foreground)" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Godowns</h2>
              {!pricingFocused && (
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{godowns.length} {godowns.length === 1 ? "warehouse" : "warehouses"}</p>
              )}
              {pricingFocused && (
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{godowns.length} {godowns.length === 1 ? "warehouse" : "warehouses"} · tap to expand</p>
              )}
            </div>
          </div>
          {!pricingFocused && (
            <button
              onClick={() => setGodownSheet({ open: true })}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-opacity hover:opacity-80 active:scale-95"
              style={{ background: "var(--foreground)", color: "var(--background)", minHeight: "36px" }}
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          )}
        </div>

        {/* Godowns content — collapses when pricingFocused */}
        <div
          style={{
            maxHeight: pricingFocused ? 0 : "600px",
            overflow: "hidden",
            transition: "max-height 0.35s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          <div className="px-5 pb-5">
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
          </div>
        </div>
      </section>

      {/* ── Price Lists ──────────────────────────────────────── */}
      {isAdmin && (
        <PriceListsSection
          priceLists={priceLists}
          skus={skus}
          onChanged={load}
          onFocusChange={setPricingFocused}
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

function PriceListsSection({ priceLists, skus, onChanged, onFocusChange }: {
  priceLists: PriceListRow[];
  skus: SkuFullRow[];
  onChanged: () => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const [openList, setOpenList]       = useState<PriceListRow | null>(null);
  const [newListTier, setNewListTier] = useState<PriceTier | null>(null);
  const [deleting, setDeleting]       = useState<string | null>(null);
  // createdList: price list created inline during the new-list flow
  const [createdList, setCreatedList] = useState<PriceListRow | null>(null);

  // Notify parent whenever a price-list form opens or closes
  const openForm = React.useCallback((tier: PriceTier) => {
    setNewListTier(tier);
    onFocusChange(true);
  }, [onFocusChange]);

  const closeNewForm = React.useCallback(() => {
    setNewListTier(null);
    setCreatedList(null);
    onFocusChange(false);
  }, [onFocusChange]);

  const doneNewForm = React.useCallback(() => {
    setNewListTier(null);
    setCreatedList(null);
    onFocusChange(false);
    onChanged();
  }, [onFocusChange, onChanged]);

  const openEdit = React.useCallback((pl: PriceListRow) => {
    setOpenList(pl);
    onFocusChange(true);
  }, [onFocusChange]);

  const closeEdit = React.useCallback(() => {
    setOpenList(null);
    onFocusChange(false);
  }, [onFocusChange]);

  const doneEdit = React.useCallback(() => {
    setOpenList(null);
    onFocusChange(false);
    onChanged();
  }, [onFocusChange, onChanged]);

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
                  onClick={() => openForm(tier)}
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
                        onClick={() => openEdit(pl)}
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

      {/* New list + add SKUs — combined single-screen flow */}
      {newListTier && (
        <NewPriceListWithSkusSheet
          tier={newListTier}
          skus={skus}
          createdList={createdList}
          onListCreated={setCreatedList}
          onClose={closeNewForm}
          onDone={doneNewForm}
        />
      )}

      {/* Edit existing list items */}
      {openList && (
        <PriceListItemsSheet
          priceList={openList}
          skus={skus}
          onClose={closeEdit}
          onDone={doneEdit}
        />
      )}
    </section>
  );
}

/* ── Combined: New Price List + Add SKUs in one screen ────────────────── */
// UX fix: no more two-step flow. Name/date at top, SKU pricing below.
// The list header is created lazily when the first SKU price is saved.
function NewPriceListWithSkusSheet({ tier, skus, createdList, onListCreated, onClose, onDone }: {
  tier: PriceTier;
  skus: SkuFullRow[];
  createdList: PriceListRow | null;
  onListCreated: (pl: PriceListRow) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = TIERS.find((x) => x.value === tier)!;
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName]                   = useState(`${t.label} Price List`);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [items, setItems]                 = useState<PriceListItemRow[]>([]);
  const [search, setSearch]               = useState("");
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [showSkuPrice, setShowSkuPrice]   = useState(false);
  const [creatingHeader, setCreatingHeader] = useState(false);
  const [deleting, setDeleting]           = useState<string | null>(null);

  const setSkuIds = useMemo(() => new Set(items.map((i) => i.sku_id)), [items]);
  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase();
    return skus
      .filter((s) => s.is_active && !setSkuIds.has(s.id))
      .filter((s) => !term || [s.brand_name, s.model_name, s.variant_display ?? "", s.internal_code ?? ""].join(" ").toLowerCase().includes(term))
      .slice(0, 40);
  }, [skus, setSkuIds, search]);

  // Ensure list header exists before saving an item
  async function ensureList(): Promise<PriceListRow> {
    if (createdList) return createdList;
    setCreatingHeader(true);
    try {
      const pl = await createPriceList({ name: name.trim() || `${t.label} Price List`, tier, effective_from: effectiveFrom, notes: null });
      onListCreated(pl);
      return pl;
    } finally { setCreatingHeader(false); }
  }

  async function handleSkuSaved(item: PriceListItemRow) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.sku_id === item.sku_id);
      return idx >= 0 ? prev.map((i, n) => n === idx ? item : i) : [...prev, item];
    });
    setShowSkuPrice(false);
    setSelectedSkuId("");
    setSearch("");
  }

  async function handleDelete(itemId: string) {
    setDeleting(itemId);
    try { await deletePriceListItem(itemId); setItems((p) => p.filter((i) => i.id !== itemId)); toast.success("Removed"); }
    catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(null); }
  }

  return (
    /* z-[200] — above topbar (z-40), sidebar, bottom nav, and any other overlay */
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--background)", zIndex: 200 }}>

      {/* ── Fixed header: close + name + date + Done ── */}
      <div
        className="shrink-0 px-4 pt-4 pb-3 space-y-3"
        style={{ borderBottom: "1px solid var(--glass-border-lo)", background: "var(--background)" }}
      >
        {/* Row 1: back button + tier label + Done */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 active:scale-95 transition"
            style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: t.color }}>{t.label} Tier</p>
            <p className="text-[15px] font-semibold leading-tight" style={{ color: "var(--foreground)" }}>New Price List</p>
          </div>
          {items.length > 0 ? (
            <button
              onClick={onDone}
              className="px-4 py-2 rounded-full text-xs font-bold active:scale-95 transition"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              Done ({items.length})
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-medium"
              style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}
            >
              Cancel
            </button>
          )}
        </div>

        {/* Row 2: name + date — always visible, never scrolls away */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>List name *</p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!createdList}
              placeholder="e.g. Retail Price List"
              className={inputCls + (createdList ? " opacity-50 cursor-not-allowed" : "")}
              style={{ height: 40, fontSize: 13 }}
            />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>Effective from *</p>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              disabled={!!createdList}
              min={today}
              className={inputCls + (createdList ? " opacity-50 cursor-not-allowed" : "")}
              style={{ height: 40, fontSize: 13 }}
            />
          </div>
        </div>
        {createdList && (
          <p className="text-[11px] font-medium" style={{ color: "var(--snm-success)" }}>✓ List created — keep adding SKU prices below</p>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* Added SKUs so far */}
        {items.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "var(--muted-foreground)" }}>Added ({items.length})</p>
            {items.map((item) => {
              const sku = skus.find((s) => s.id === item.sku_id);
              return (
                <div key={item.id} className="rounded-2xl p-4" style={{ background: "var(--glass-1)", border: "1px solid var(--glass-border-lo)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
                        {sku ? `${sku.brand_name} › ${sku.model_name}` : item.sku_id}
                      </p>
                      {sku?.variant_display && <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{sku.variant_display}</p>}
                    </div>
                    <button onClick={() => handleDelete(item.id)} disabled={deleting === item.id} className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ color: "var(--muted-foreground)" }}>
                      {deleting === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
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
                </div>
              );
            })}
          </div>
        )}

        {/* Add SKU area */}
        {!showSkuPrice ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "var(--muted-foreground)" }}>Add SKU prices</p>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brand, SKU, variant…"
              className={inputCls}
            />
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--glass-border-lo)", maxHeight: 280, overflowY: "auto" }}>
              {filteredSkus.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: "var(--muted-foreground)" }}>
                  {search ? "No matches" : skus.filter(s => s.is_active).length === setSkuIds.size ? "All SKUs added" : "Search for a SKU above"}
                </p>
              ) : filteredSkus.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedSkuId(s.id); setShowSkuPrice(true); }}
                  className="w-full text-left px-4 py-3 flex flex-col transition-colors"
                  style={{ borderBottom: "1px solid var(--glass-border-lo)", background: "transparent" }}
                >
                  <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                    {s.brand_name} › {s.model_name}
                    {s.variant_display ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {s.variant_display}</span> : null}
                  </p>
                  {s.landed_per_piece_mvr != null && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      Landed MVR {Number(s.landed_per_piece_mvr).toFixed(3)}/pc
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <SkuPriceEntry
            sku={skus.find((s) => s.id === selectedSkuId) ?? null}
            creatingHeader={creatingHeader}
            onBack={() => { setShowSkuPrice(false); setSelectedSkuId(""); }}
            onSave={async (prices) => {
              try {
                const list = await ensureList();
                await upsertPriceListItem({ price_list_id: list.id, sku_id: selectedSkuId, ...prices });
                // upsertPriceListItem doesn't return the row — reload by fetching items
                const updated = await listPriceListItems(list.id);
                const newItem = updated.find((i) => i.sku_id === selectedSkuId);
                if (newItem) handleSkuSaved(newItem);
                else { setShowSkuPrice(false); setSelectedSkuId(""); }
                toast.success("Price saved");
              } catch (e) { toast.error((e as Error).message); }
            }}
          />
        )}
      </div>
    </div>
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
  const [items, setItems]       = useState<PriceListItemRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [addSkuId, setAddSkuId] = useState("");
  const [addSheet, setAddSheet] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Which item is currently open for inline editing (by item.id)
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

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
    if (!confirm("Remove this SKU from the price list?")) return;
    setDeleting(itemId);
    try {
      await deletePriceListItem(itemId);
      toast.success("Removed");
      loadItems();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(null); }
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: "var(--background)", zIndex: 200 }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--glass-border-lo)" }}>
        <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}>
          <X className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: t.color }}>{t.label} Tier</p>
          <h2 className="text-base font-semibold truncate" style={{ color: "var(--foreground)" }}>{priceList.name}</h2>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Effective {new Date(priceList.effective_from + "T00:00:00").toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <button
          onClick={() => { setAddSheet(true); setAddSkuId(""); setSearch(""); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shrink-0 active:scale-95 transition"
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
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>No SKUs yet</p>
            <p className="text-xs mt-1 mb-5" style={{ color: "var(--muted-foreground)" }}>Tap "Add SKU" to set prices for this tier</p>
            <button
              onClick={() => { setAddSheet(true); setAddSkuId(""); setSearch(""); }}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-semibold active:scale-95 transition"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              <Plus className="h-4 w-4" /> Add first SKU
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs px-1 pb-1" style={{ color: "var(--muted-foreground)" }}>
              {items.length} SKU{items.length !== 1 ? "s" : ""} — tap any row to edit prices
            </p>
            {items.map((item) => {
              const sku = skus.find((s) => s.id === item.sku_id);
              const isEditing = editingItemId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: "var(--glass-1)",
                    border: isEditing
                      ? `1px solid color-mix(in srgb, ${t.color} 40%, transparent)`
                      : "1px solid var(--glass-border-lo)",
                  }}
                >
                  {/* Summary row — always visible, tap to expand editor */}
                  <button
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition active:bg-black/5"
                    onClick={() => setEditingItemId(isEditing ? null : item.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
                        {sku ? `${sku.brand_name} › ${sku.model_name}` : item.sku_id}
                      </p>
                      {sku?.variant_display && (
                        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{sku.variant_display}</p>
                      )}
                    </div>
                    {/* Price pills — compact summary */}
                    <div className="flex gap-1.5 shrink-0">
                      {[
                        { label: "pc",  value: item.price_per_piece_mvr },
                        { label: "pk",  value: item.price_per_pack_mvr },
                        { label: "ctn", value: item.price_per_carton_mvr },
                      ].map((p) => (
                        <div key={p.label} className="rounded-lg px-2 py-1 text-center" style={{ background: `color-mix(in srgb, ${t.color} 10%, transparent)` }}>
                          <p className="text-[8px] uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{p.label}</p>
                          <p className="text-[11px] font-bold" style={{ color: t.color }}>{Number(p.value).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                    {/* Edit/chevron indicator */}
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: isEditing ? `color-mix(in srgb, ${t.color} 15%, transparent)` : "color-mix(in srgb, var(--foreground) 6%, transparent)" }}>
                      <Pencil className="h-3 w-3" style={{ color: isEditing ? t.color : "var(--muted-foreground)" }} />
                    </div>
                  </button>

                  {/* Inline edit form — expands when tapped */}
                  {isEditing && sku && (
                    <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid var(--glass-border-lo)" }}>
                      <SkuPriceEntry
                        sku={sku}
                        initialPrices={{
                          piece:  Number(item.price_per_piece_mvr),
                          pack:   Number(item.price_per_pack_mvr),
                          carton: Number(item.price_per_carton_mvr),
                        }}
                        creatingHeader={false}
                        onBack={() => setEditingItemId(null)}
                        onSave={async (prices) => {
                          await upsertPriceListItem({ price_list_id: priceList.id, sku_id: item.sku_id, ...prices });
                          toast.success("Price updated");
                          setEditingItemId(null);
                          loadItems();
                        }}
                        saveLabel="UPDATE PRICE"
                        extraAction={
                          <button
                            onClick={() => handleDelete(item.id)}
                            disabled={deleting === item.id}
                            className="flex-1 py-3 rounded-full text-sm font-medium flex items-center justify-center gap-1.5 transition-opacity hover:opacity-70"
                            style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", color: "var(--snm-error)", border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)" }}
                          >
                            {deleting === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Trash2 className="h-3.5 w-3.5" /> Remove</>}
                          </button>
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Add SKU — full-screen overlay */}
      {addSheet && (
        <div className="fixed inset-0 flex flex-col" style={{ background: "var(--background)", zIndex: 210 }}>
          <div className="flex items-center gap-3 px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--glass-border-lo)" }}>
            <button onClick={() => { setAddSheet(false); setAddSkuId(""); setSearch(""); }} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--glass-1)", color: "var(--muted-foreground)" }}>
              <X className="h-4 w-4" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: t.color }}>{t.label}</p>
              <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
                {addSkuId ? "Set Prices" : "Add SKU"}
              </h2>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {!addSkuId ? (
              <>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Search and select a SKU to set its {t.label.toLowerCase()} tier prices.
                </p>
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search brand, SKU, variant…"
                  className={inputCls}
                />
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--glass-border-lo)", maxHeight: 400, overflowY: "auto" }}>
                  {filteredSkus.length === 0 ? (
                    <p className="text-sm text-center py-6" style={{ color: "var(--muted-foreground)" }}>
                      {search ? "No matches" : "All active SKUs already have prices in this list"}
                    </p>
                  ) : filteredSkus.map((s) => (
                    <button key={s.id} onClick={() => setAddSkuId(s.id)} className="w-full text-left px-4 py-3.5 flex flex-col transition active:bg-black/5" style={{ borderBottom: "1px solid var(--glass-border-lo)", background: "transparent" }}>
                      <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                        {s.brand_name} › {s.model_name}
                        {s.variant_display ? <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {s.variant_display}</span> : null}
                      </p>
                      {s.landed_per_piece_mvr != null && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Landed MVR {Number(s.landed_per_piece_mvr).toFixed(3)}/pc</p>
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <SkuPriceEntry
                sku={filteredSkus.find((s) => s.id === addSkuId) ?? skus.find((s) => s.id === addSkuId) ?? null}
                creatingHeader={false}
                onBack={() => setAddSkuId("")}
                onSave={async (prices) => {
                  await upsertPriceListItem({ price_list_id: priceList.id, sku_id: addSkuId, ...prices });
                  toast.success("Price saved");
                  setAddSheet(false); setAddSkuId(""); setSearch("");
                  loadItems();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── SkuPriceEntry ─────────────────────────────────────────────────────── */
// Reusable price entry component used in both new-list and edit-list flows.
//
// KEY UX FIX (Problem 2):
//   - Margin % → fills all three prices (piece/pack/carton) proportionally
//   - Pack price typed manually → ONLY updates piece (÷ pcsPerPack) + margin
//     Carton is NOT touched — it stays independent
//   - Carton price typed manually → ONLY updates margin display
//     Pack is NOT touched — they are decoupled
//   - Piece typed → ONLY updates margin
//   This means pack and carton can be set to DIFFERENT effective-per-piece rates
//   which is exactly how volume discounts work in FMCG.

function SkuPriceEntry({ sku, creatingHeader, onBack, onSave, initialPrices, saveLabel, extraAction }: {
  sku: SkuFullRow | null;
  creatingHeader: boolean;
  onBack: () => void;
  onSave: (prices: { price_per_piece_mvr: number; price_per_pack_mvr: number; price_per_carton_mvr: number; margin_pct: number | null }) => Promise<void>;
  initialPrices?: { piece: number; pack: number; carton: number };
  saveLabel?: string;
  extraAction?: React.ReactNode;
}) {
  const landed        = sku?.landed_per_piece_mvr ? Number(sku.landed_per_piece_mvr) : null;
  const pcsPerPack    = sku?.pcs_per_pack    ?? 1;
  const packsPerCarton = sku?.packs_per_carton ?? 1;
  const pcsPerCarton  = pcsPerPack * packsPerCarton;

  const [marginStr, setMarginStr] = useState(() => {
    if (!initialPrices || !landed || initialPrices.piece <= 0) return "";
    return ((1 - landed / initialPrices.piece) * 100).toFixed(1);
  });
  const [packStr,   setPackStr]   = useState(() => initialPrices ? String(initialPrices.pack)   : "");
  const [cartonStr, setCartonStr] = useState(() => initialPrices ? String(initialPrices.carton) : "");
  const [pieceStr,  setPieceStr]  = useState(() => initialPrices ? String(initialPrices.piece)  : "");
  const [saving,    setSaving]    = useState(false);

  // Margin → derive all three prices proportionally (initial fill only)
  function applyMargin(mStr: string) {
    setMarginStr(mStr);
    const m = parseFloat(mStr);
    if (!landed || isNaN(m) || m >= 100 || m < 0) return;
    const piece = landed / (1 - m / 100);
    setPieceStr(piece.toFixed(2));
    setPackStr((piece * pcsPerPack).toFixed(2));
    setCartonStr((piece * pcsPerCarton).toFixed(2));
  }

  // Pack typed → update piece + margin, leave carton alone
  function applyPack(pStr: string) {
    setPackStr(pStr);
    const pk = parseFloat(pStr);
    if (isNaN(pk) || pk <= 0) return;
    const piece = pk / pcsPerPack;
    setPieceStr(piece.toFixed(2));
    if (landed && piece > 0) setMarginStr(((1 - landed / piece) * 100).toFixed(1));
  }

  // Carton typed → update margin display based on carton's effective piece price, leave pack alone
  function applyCarton(cStr: string) {
    setCartonStr(cStr);
    const c = parseFloat(cStr);
    if (isNaN(c) || c <= 0) return;
    // Don't change pack or piece — carton is independent
    // Show carton margin as a separate indicator (handled in render)
  }

  // Piece typed → update margin only
  function applyPiece(pStr: string) {
    setPieceStr(pStr);
    const p = parseFloat(pStr);
    if (isNaN(p) || p <= 0) return;
    if (landed && p > 0) setMarginStr(((1 - landed / p) * 100).toFixed(1));
  }

  const packMargin  = landed && parseFloat(packStr)   > 0 ? ((1 - landed / (parseFloat(packStr)   / pcsPerPack))   * 100) : null;
  const cartonMargin = landed && parseFloat(cartonStr) > 0 ? ((1 - landed / (parseFloat(cartonStr) / pcsPerCarton)) * 100) : null;

  function marginColor(m: number | null) {
    if (m === null) return "var(--muted-foreground)";
    return m >= 25 ? "var(--snm-success)" : m >= 15 ? "var(--snm-warning)" : "var(--snm-error)";
  }

  const canSave = sku
    && parseFloat(packStr)   > 0
    && parseFloat(cartonStr) > 0
    && parseFloat(pieceStr)  > 0;

  async function handleSave() {
    if (!canSave || !sku) return;
    setSaving(true);
    try {
      await onSave({
        price_per_piece_mvr:  parseFloat(pieceStr),
        price_per_pack_mvr:   parseFloat(packStr),
        price_per_carton_mvr: parseFloat(cartonStr),
        margin_pct:           packMargin !== null ? parseFloat(packMargin.toFixed(1)) : null,
      });
    } finally { setSaving(false); }
  }

  if (!sku) return null;

  return (
    <div className="rounded-2xl p-4 space-y-4" style={{ background: "var(--glass-1)", border: "1px solid var(--glass-border-lo)" }}>
      {/* SKU identity */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{sku.brand_name} › {sku.model_name}</p>
          {sku.variant_display && <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{sku.variant_display}</p>}
          <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            {pcsPerPack} pcs/pack · {packsPerCarton} packs/carton · {pcsPerCarton} pcs/carton
          </p>
          {landed != null && (
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Landed: <span className="font-semibold" style={{ color: "var(--foreground)" }}>MVR {landed.toFixed(3)}/pc</span>
            </p>
          )}
        </div>
        <button onClick={onBack} className="text-xs px-2 py-1 rounded-lg shrink-0" style={{ color: "var(--muted-foreground)", background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
          ← Back
        </button>
      </div>

      {/* Margin quick-fill */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--muted-foreground)" }}>
          Quick fill: target margin %
        </p>
        <div className="relative">
          <input
            autoFocus
            type="number" inputMode="decimal" step="0.5" min="0" max="99"
            value={marginStr}
            onChange={(e) => applyMargin(e.target.value)}
            placeholder={landed ? "e.g. 30 → fills all prices" : "No landed cost yet"}
            disabled={!landed}
            className={inputCls}
            style={{ paddingRight: 36 }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ color: "var(--muted-foreground)" }}>%</span>
        </div>
        {!landed && <p className="text-xs mt-1" style={{ color: "var(--snm-warning)" }}>No landed cost — enter prices manually below.</p>}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "var(--glass-border-lo)" }} />
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>set each price independently</p>
        <div className="flex-1 h-px" style={{ background: "var(--glass-border-lo)" }} />
      </div>

      {/* Pack price — independent */}
      <SheetInput label={`Pack price — ${pcsPerPack} pcs`} required>
        <input
          type="number" inputMode="decimal" step="0.5" min="0.01"
          value={packStr}
          onChange={(e) => applyPack(e.target.value)}
          placeholder="e.g. 100"
          className={inputCls}
        />
        {packMargin !== null && (
          <p className="text-xs mt-1 font-semibold" style={{ color: marginColor(packMargin) }}>
            {packMargin.toFixed(1)}% margin on packs
            {packMargin < 15 && " · ⚠ below minimum"}
          </p>
        )}
      </SheetInput>

      {/* Carton price — fully independent from pack */}
      <SheetInput label={`Carton price — ${pcsPerCarton} pcs (volume discount)`} required>
        <input
          type="number" inputMode="decimal" step="1" min="0.01"
          value={cartonStr}
          onChange={(e) => applyCarton(e.target.value)}
          placeholder="e.g. 360 (lower than 4 × pack = 400)"
          className={inputCls}
        />
        {cartonMargin !== null && packMargin !== null && (
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs font-semibold" style={{ color: marginColor(cartonMargin) }}>
              {cartonMargin.toFixed(1)}% margin on cartons
            </p>
            {parseFloat(cartonStr) < parseFloat(packStr) * packsPerCarton && (
              <p className="text-xs" style={{ color: "var(--snm-success)" }}>
                ✓ MVR {(parseFloat(packStr) * packsPerCarton - parseFloat(cartonStr)).toFixed(2)} carton discount
              </p>
            )}
            {parseFloat(cartonStr) >= parseFloat(packStr) * packsPerCarton && (
              <p className="text-xs" style={{ color: "var(--snm-warning)" }}>
                ⚠ No discount vs buying packs
              </p>
            )}
          </div>
        )}
      </SheetInput>

      {/* Piece price */}
      <SheetInput label="Piece price (optional)">
        <input
          type="number" inputMode="decimal" step="0.01" min="0.01"
          value={pieceStr}
          onChange={(e) => applyPiece(e.target.value)}
          placeholder="auto-filled from pack ÷ pcs"
          className={inputCls}
        />
      </SheetInput>

      {/* Actions row: optional extraAction (e.g. Remove button) + save */}
      <div className="flex gap-3 mt-6">
        {extraAction}
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-full text-sm font-medium transition-opacity hover:opacity-70"
          style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)" }}
        >Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving || creatingHeader || !canSave}
          className="flex-[2] py-3 rounded-full text-xs font-bold uppercase tracking-widest transition-opacity hover:opacity-85 active:scale-95 disabled:opacity-40"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          {saving || creatingHeader ? "Saving…" : (saveLabel ?? "SAVE PRICE")}
        </button>
      </div>
    </div>
  );
}
