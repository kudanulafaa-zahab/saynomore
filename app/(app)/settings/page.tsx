"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Users, Pencil, Trash2,
  UserCheck, UserCog, Truck, Plus, ShieldCheck, LogOut, Eye, EyeOff,
  Bell, BellRing,
} from "lucide-react";
import {
  listUsers, updateUser, deleteUser, inviteUser,
  type UserProfileRow, type UserRole,
} from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";
import { supabase } from "@/lib/supabase";
import { subscribeToPush, isPushSubscribed } from "@/lib/push";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin", manager: "Manager", staff: "Staff", viewer: "Viewer",
};
const ROLE_LABEL_FULL: Record<UserRole, string> = {
  admin: "Administrator", manager: "Manager", staff: "Delivery Staff", viewer: "Viewer",
};
const ROLE_DESC: Record<UserRole, string> = {
  admin: "Full access. Can delete master data and manage users.",
  manager: "Full operational access. Cannot manage users.",
  staff: "Can only see and update their own deliveries.",
  viewer: "Read-only access. Can see everything but cannot add, edit, or delete anything.",
};
const ROLE_ICON: Record<UserRole, React.ElementType> = {
  admin: UserCheck, manager: UserCog, staff: Truck, viewer: Eye,
};
const ROLE_COLOR: Record<UserRole, string> = {
  admin: "var(--foreground)",
  manager: "var(--snm-brand)",
  staff: "var(--muted-foreground)",
  viewer: "var(--muted-foreground)",
};

// Suppress unused-variable warning — ROLE_LABEL_FULL is kept for future use
void ROLE_LABEL_FULL;

export default function SettingsPage() {
  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);

  const [inviteSheet, setInviteSheet] = useState(false);
  const [editUserSheet, setEditUserSheet] = useState<UserProfileRow | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfileRow | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => { isPushSubscribed().then(setPushEnabled); }, []);

  async function handleTestNotification() {
    setPushBusy(true);
    try {
      // Make sure this device is subscribed first
      if (!pushEnabled) {
        const result = await subscribeToPush();
        setPushEnabled(result.ok);
        if (!result.ok) {
          toast.error(result.reason ?? "Could not enable notifications");
          return;
        }
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { toast.error("Not signed in"); return; }

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-push`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            user_id: userData.user.id,
            title: "SayNoMore test",
            body: "Push notifications are working ✅",
            url: "/settings",
          }),
        }
      );

      const json = await res.json().catch(() => ({}));
      if (res.ok && json.sent > 0) {
        toast.success("Test sent — check your phone in a moment");
      } else if (res.ok && json.sent === 0) {
        toast.error("No device registered — try again to enable notifications");
        setPushEnabled(false);
      } else {
        toast.error(json.error ?? "Failed to send test notification");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function load() {
    setLoading(true);
    try {
      const u = await listUsers();
      setUsers(u);
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
        <p className="label-caps text-[12px] mb-1" style={{ color: "var(--muted-foreground)" }}>System</p>
        <h1 className="ios-page-title">Settings</h1>
      </div>

      {/* ── Team Members ──────────────────────────────────────── */}
      <section
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow), var(--glass-inner)",
        }}
      >
        {/* Section header */}
        <div className="flex items-center justify-between px-5 py-4">
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
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold active:opacity-70 active:scale-95"
              style={{ background: "var(--foreground)", color: "var(--background)", minHeight: "36px" }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Member
            </button>
          )}
        </div>

        {/* Users list */}
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
                            <span className="text-[12px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md shrink-0"
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
                        <span className="text-[12px] font-semibold hidden sm:block" style={{ color: "var(--foreground)" }}>
                          {ROLE_LABEL[u.role]}
                        </span>
                      </div>
                      {!isMe && (
                        <>
                          <button
                            onClick={() => setEditUserSheet(u)}
                            className="w-11 h-11 rounded-xl flex items-center justify-center active:opacity-60"
                            style={{ color: "var(--muted-foreground)" }}
                            aria-label={`Edit ${u.full_name ?? u.email}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteUserTarget(u)}
                            className="w-11 h-11 rounded-xl flex items-center justify-center active:opacity-60"
                            style={{ color: "var(--snm-error)" }}
                            aria-label={`Remove ${u.full_name ?? u.email}`}
                          >
                            <Trash2 className="h-4 w-4" />
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
      </section>

      {/* ── Notifications ─────────────────────────────────────── */}
      <section
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow), var(--glass-inner)",
        }}
      >
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
            <Bell className="h-4 w-4" style={{ color: "var(--foreground)" }} />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Notifications</h2>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {pushEnabled === null
                ? "Checking…"
                : pushEnabled
                  ? "This device is registered"
                  : "Not enabled on this device"}
            </p>
          </div>
        </div>
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between gap-4 px-4 py-4 rounded-xl"
            style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Send a test push to this phone to confirm notifications work.
            </p>
            <button
              onClick={handleTestNotification}
              disabled={pushBusy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition active:scale-95 active:opacity-70 disabled:opacity-40 shrink-0"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {pushBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              {pushBusy ? "Sending…" : "Send test"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Sign out ──────────────────────────────────────────── */}
      <section
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--glass-1)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow), var(--glass-inner)",
        }}
      >
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Sign out</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>You&apos;ll be returned to the login screen</p>
            </div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition active:scale-95 active:opacity-70 disabled:opacity-40 shrink-0"
              style={{
                background: "color-mix(in srgb, var(--snm-error) 10%, transparent)",
                color: "var(--snm-error)",
                border: "1px solid color-mix(in srgb, var(--snm-error) 25%, transparent)",
              }}
            >
              {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </section>

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
    </div>
  );
}

/* ── Sheet wrapper ─────────────────────────────────────────────────────── */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="w-full p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: "20px 20px 0 0", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "var(--glass-border)" }} />
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>{title}</h2>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full flex items-center justify-center text-lg leading-none active:opacity-60"
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
        className="flex-1 py-3 rounded-full text-sm font-medium active:opacity-60"
        style={{ background: "color-mix(in srgb, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)" }}
      >Cancel</button>
      <button
        onClick={onConfirm}
        disabled={disabled}
        className="flex-[2] py-3 rounded-full text-xs font-bold uppercase tracking-widest active:opacity-80 active:scale-95 disabled:opacity-40"
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
      <div className="w-full max-w-sm p-6 rounded-3xl" style={{ background: "var(--glass-2)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", border: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg), var(--glass-inner)" }}>
        <p className="text-base font-semibold mb-2" style={{ color: "var(--foreground)" }}>{title}</p>
        <p className="text-sm mb-6" style={{ color: "var(--muted-foreground)" }}>{body}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-full text-sm font-medium active:opacity-60"
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
  const [showTempPw, setShowTempPw] = useState(false);
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
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Ahmed Hassan" className={inputCls} />
      </SheetInput>
      <SheetInput label="Email Address" required>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ahmed@example.com" className={inputCls} />
      </SheetInput>
      <SheetInput label="Role" required>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputCls}>
          <option value="manager">Manager — Full operational access</option>
          <option value="staff">Delivery Staff — Deliveries only</option>
          <option value="viewer">Viewer — Read only, no edits</option>
        </select>
      </SheetInput>
      <SheetInput label="Temporary Password" required>
        <div className="relative">
          <input
            type={showTempPw ? "text" : "password"}
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            placeholder="Min 6 characters"
            className={inputCls}
            style={{ paddingRight: "44px" }}
          />
          <button
            type="button"
            onClick={() => setShowTempPw((v) => !v)}
            aria-label={showTempPw ? "Hide password" : "Show password"}
            className="absolute right-0 top-0 h-full w-11 flex items-center justify-center transition-opacity hover:opacity-70 active:opacity-50"
            style={{ color: "var(--muted-foreground)" }}
          >
            {showTempPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
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
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
      </SheetInput>
      {user.role !== "admin" && (
        <SheetInput label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputCls}>
            <option value="manager">Manager — Full operational access</option>
            <option value="staff">Delivery Staff — Deliveries only</option>
            <option value="viewer">Viewer — Read only, no edits</option>
          </select>
          <p className="text-xs mt-1.5" style={{ color: "var(--muted-foreground)" }}>{ROLE_DESC[role]}</p>
        </SheetInput>
      )}
      <SheetActions onCancel={onClose} onConfirm={save} disabled={saving || !fullName.trim()} label={saving ? "Saving…" : "SAVE CHANGES"} />
    </Sheet>
  );
}

