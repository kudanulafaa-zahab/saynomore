"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, UserCircle, Shield, Truck, Users, Eye, EyeOff,
  AlertTriangle, Pencil, Trash2, Bell, Copy, Check,
} from "lucide-react";
import { AdminNotificationsDialog } from "@/components/settings/notifications-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listUsers,
  updateUser,
  deleteUser,
  inviteUser,
  type UserProfileRow,
  type UserRole,
} from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";
import { haptic } from "@/lib/haptics";
import { useOnMount } from "@/lib/use-on-mount";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  staff: "Delivery Staff",
  viewer: "Viewer",
};

const ROLE_DESC: Record<UserRole, string> = {
  admin: "Full access. Can delete master data and manage users.",
  manager: "Full operational access. Cannot manage users.",
  staff: "Can only see and update their own deliveries.",
  viewer: "Read-only access. Can see everything but cannot add, edit, or delete.",
};

const ROLE_ICON: Record<UserRole, typeof Shield> = {
  admin: Shield,
  manager: UserCircle,
  staff: Truck,
  viewer: Eye,
};

const ROLE_TOKEN: Record<UserRole, string> = {
  admin:   "var(--foreground)",
  manager: "var(--snm-brand)",
  staff:   "var(--muted-foreground)",
  viewer:  "var(--muted-foreground)",
};

export function UsersManager() {
  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [editDialog, setEditDialog] = useState<UserProfileRow | null>(null);
  const [notifDialog, setNotifDialog] = useState<UserProfileRow | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<UserProfileRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try { setUsers(await listUsers()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  useOnMount(load);
  useEffect(() => {
    getCurrentUserRole().then(setMyRole).catch(() => {});
    // Get current user id
    import("@/lib/supabase").then(({ supabase }) => {
      supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
    });
  }, []);

  const isAdmin = myRole === "admin";

  if (!isAdmin) {
    return (
      <div className="glass p-10 text-center space-y-2">
        <Shield className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="ios-subhead text-muted-foreground">Only administrators can manage users.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="ios-subhead">Loading users…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground">Team Members</h2>
          <p className="ios-subhead text-muted-foreground">Manage who has access and what they can do.</p>
        </div>
        <Button onClick={() => setInviteDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add member
        </Button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => {
          const Icon = ROLE_ICON[r];
          return (
            <div key={r} className="glass-flat p-3 rounded-xl space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className="h-6 w-6 rounded-lg flex items-center justify-center"
                  style={{ background: `color-mix(in srgb, ${ROLE_TOKEN[r]} 12%, transparent)`, color: ROLE_TOKEN[r] }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <p className="ios-subhead font-medium text-foreground">{ROLE_LABEL[r]}</p>
              </div>
              <p className="ios-subhead text-muted-foreground">{ROLE_DESC[r]}</p>
            </div>
          );
        })}
      </div>

      {users.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--glass-bg-2)" }}
          >
            <Users className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-medium text-foreground">No team members yet</h3>
          <p className="ios-subhead text-muted-foreground max-w-sm mx-auto">
            {/* NO EMAIL IS EVER SENT, and this line used to promise one.
                The account is created straight away with the password you
                type, already confirmed, so they can log in immediately — the
                deliberate choice, because an email link is one more thing to
                go wrong. But the screen said the opposite, so a new viewer sat
                waiting for an invitation that was never coming while their
                account worked perfectly. */}
            Add your manager, delivery staff or a viewer. You set their password and pass it on —
            nothing is emailed.
          </p>
          <Button onClick={() => setInviteDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add first member
          </Button>
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {users.map((u) => {
            const Icon = ROLE_ICON[u.role];
            const isMe = u.id === myId;
            return (
              <div key={u.id} className="p-4 flex items-center justify-between gap-3 hover:bg-accent/30 transition">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `color-mix(in srgb, ${ROLE_TOKEN[u.role]} 12%, transparent)`, color: ROLE_TOKEN[u.role] }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="ios-subhead font-medium text-foreground">{u.full_name ?? "—"}</p>
                      {isMe && (
                        <span className="text-[12px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">You</span>
                      )}
                    </div>
                    <p className="ios-subhead text-muted-foreground truncate">{u.email ?? "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span
                    className="text-[12px] uppercase tracking-wider rounded px-2 py-0.5"
                    style={{ background: `color-mix(in srgb, ${ROLE_TOKEN[u.role]} 12%, transparent)`, color: ROLE_TOKEN[u.role] }}
                  >
                    {ROLE_LABEL[u.role]}
                  </span>
                  <button
                    onClick={() => setNotifDialog(u)}
                    aria-label={`Notifications for ${u.full_name ?? u.email}`}
                    className="h-11 w-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition"
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                  {!isMe && (
                    <>
                      <button
                        onClick={() => setEditDialog(u)}
                        aria-label={`Edit ${u.full_name ?? u.email}`}
                        className="h-11 w-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteDialog(u)}
                        aria-label={`Remove ${u.full_name ?? u.email}`}
                        className="h-11 w-11 flex items-center justify-center rounded-lg text-muted-foreground/70 hover:text-[var(--snm-error)] hover:bg-[color-mix(in_srgb,var(--snm-error)_10%,transparent)] transition"
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

      <InviteDialog
        open={inviteDialog}
        onOpenChange={setInviteDialog}
        onDone={() => { setInviteDialog(false); load(); }}
      />

      {notifDialog && (
        <AdminNotificationsDialog
          userId={notifDialog.id}
          userName={notifDialog.full_name ?? notifDialog.email ?? "member"}
          onClose={() => setNotifDialog(null)}
        />
      )}

      {editDialog && (
        <EditUserDialog
          user={editDialog}
          onOpenChange={(o) => { if (!o) setEditDialog(null); }}
          onDone={() => { setEditDialog(null); load(); }}
        />
      )}

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={(o) => { if (!o) setDeleteDialog(null); }}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--snm-error) 15%, transparent)", color: "var(--snm-error)" }}>
                <AlertTriangle className="h-4 w-4" />
              </div>
              <DialogTitle>Remove team member?</DialogTitle>
            </div>
            <DialogDescription>
              <strong>{deleteDialog?.full_name ?? deleteDialog?.email}</strong> will lose all access
              immediately. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialog(null)}>Cancel</Button>
            <Button
              style={{ background: "var(--snm-error)", color: "var(--background)" }}
              disabled={deleting}
              onClick={async () => {
                if (!deleteDialog) return;
                setDeleting(true);
                try {
                  await deleteUser(deleteDialog.id);
                  haptic("success");
                  toast.success(`${deleteDialog.full_name ?? "User"} removed`);
                  setDeleteDialog(null);
                  load();
                } catch (e) {
                  haptic("error");
                  toast.error((e as Error).message);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Edit user dialog ─────────────────────────────────────────────────────

function EditUserDialog({
  user, onOpenChange, onDone,
}: {
  user: UserProfileRow;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [selectedRole, setSelectedRole] = useState<UserRole>(user.role);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      await updateUser(user.id, fullName.trim(), selectedRole);
      haptic("success");
      toast.success("Updated");
      onDone();
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>Edit team member</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Full name *</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          {user.role !== "admin" && (
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={selectedRole} onValueChange={(v) => v && setSelectedRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue>{ROLE_LABEL[selectedRole]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">{ROLE_LABEL.manager}</SelectItem>
                  <SelectItem value="staff">{ROLE_LABEL.staff}</SelectItem>
                  <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
                </SelectContent>
              </Select>
              <p className="ios-subhead text-muted-foreground">{ROLE_DESC[selectedRole]}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !fullName.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Invite dialog ────────────────────────────────────────────────────────

function InviteDialog({
  open, onOpenChange, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [selectedRole, setSelectedRole] = useState<UserRole>("staff");
  const [tempPassword, setTempPassword] = useState("");
  // Set once the account exists. Holds the three things the new user needs and
  // has no other way of learning.
  const [handover, setHandover] = useState<{ name: string; email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showTempPw, setShowTempPw] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // handover and copied reset with everything else: without that, reopening
    // the dialog would show the LAST person's password instead of a blank form.
    if (open) {
      setEmail(""); setFullName(""); setSelectedRole("staff"); setTempPassword("");
      setShowTempPw(false); setHandover(null); setCopied(false);
    }
  }, [open]);

  // The invite API creates the account with this password directly
  // (email_confirm: true) — it's required server-side, not optional.
  const canSave = !!email.trim() && !!fullName.trim() && tempPassword.length >= 6;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await inviteUser(email.trim().toLowerCase(), fullName.trim(), selectedRole, tempPassword);
      haptic("success");
      toast.success(`${fullName.trim()} added successfully`);
      // DO NOT CLOSE YET. Nothing is emailed, so this dialog is the only place
      // the password will ever exist in readable form — close on save and it is
      // gone, and the new user has a working account nobody can get into.
      setHandover({
        name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password: tempPassword,
      });
    } catch (e) {
      haptic("error");
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /* ── The hand-over ────────────────────────────────────────────────────────
   * Ali, 2026-08-29: *"when I add a new user as a viewer they don't get an
   * email invitation"*.
   *
   * They never did — the account is created directly with the password he
   * types, already confirmed, which is deliberate. What was missing is the
   * other half: a way to actually TELL them. The dialog used to close on save,
   * and the password only ever existed in the field he had just typed it into.
   * The account worked; nobody could get into it.
   *
   * Copy rather than email: adding SMTP for three or four people a year means
   * an email that can bounce, land in spam, or hit a send limit. He already
   * shares a promo caption exactly this way, and WhatsApp is how he reaches
   * everyone else in this business. */
  if (handover) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // The address comes from the browser, never a hardcoded string, so this
    // can never hand someone the wrong site.
    const message =
      `SayNoMore login\n${origin}\n\nEmail: ${handover.email}\nPassword: ${handover.password}\n\n` +
      `Change the password after your first sign-in using "Forgot password".`;
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setHandover(null); onDone(); } }}>
        <DialogContent className="bg-popover border-border">
          <DialogHeader>
            <DialogTitle>Send {handover.name} their login</DialogTitle>
            <DialogDescription>
              Their account is ready now. Nothing is emailed, so send them this — it is the only
              time the password is shown.
            </DialogDescription>
          </DialogHeader>

          <div
            className="rounded-xl p-4 space-y-2"
            style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
          >
            {[
              ["Address", origin],
              ["Email", handover.email],
              ["Password", handover.password],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <span className="ios-footnote shrink-0" style={{ color: "var(--foreground)", opacity: 0.7 }}>{label}</span>
                <span className="ios-subhead font-semibold snm-num text-right break-all" style={{ color: "var(--foreground)" }}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => { setHandover(null); onDone(); }}
            >
              Done
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message);
                  setCopied(true);
                  haptic("success");
                  toast.success("Copied — paste it into WhatsApp");
                  window.setTimeout(() => setCopied(false), 2500);
                } catch {
                  // A blocked clipboard is not a failure worth hiding: the
                  // figures are on screen and can be typed.
                  toast.error("Couldn't copy — the details are above");
                }
              }}
            >
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Copied" : "Copy login"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
          <DialogDescription>
            You set a temporary password and pass it on — nothing is emailed. They can change it
            later via Forgot password.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {/* htmlFor/id on every field here: the labels sat beside their
                inputs with nothing tying them together, so a screen reader
                announced three unnamed boxes. */}
            <Label htmlFor="tm-name">Full name *</Label>
            <Input
              id="tm-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ahmed Hassan"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tm-email">Email address *</Label>
            <Input
              id="tm-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ahmed@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Role *</Label>
            <Select value={selectedRole} onValueChange={(v) => v && setSelectedRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue>{ROLE_LABEL[selectedRole]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manager">{ROLE_LABEL.manager}</SelectItem>
                <SelectItem value="staff">{ROLE_LABEL.staff}</SelectItem>
                <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
              </SelectContent>
            </Select>
            <p className="ios-subhead text-muted-foreground">{ROLE_DESC[selectedRole]}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tm-password">Temporary password *</Label>
            <div className="relative">
              <Input
                id="tm-password"
                type={showTempPw ? "text" : "password"}
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowTempPw((v) => !v)}
                aria-label={showTempPw ? "Hide password" : "Show password"}
                className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
              >
                {showTempPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="ios-subhead text-muted-foreground">Share this with the user. They can change it later via Forgot password.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
