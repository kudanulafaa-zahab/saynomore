"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, UserCircle, Shield, Truck, Users,
  ChevronDown, AlertTriangle,
} from "lucide-react";
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
  setUserRole,
  inviteUser,
  type UserProfileRow,
  type UserRole,
} from "@/lib/queries/masters";
import { getCurrentUserRole } from "@/lib/queries/products";

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

const ROLE_ICON: Record<UserRole, typeof Shield> = {
  admin: Shield,
  manager: UserCircle,
  staff: Truck,
};

const ROLE_COLOR: Record<UserRole, string> = {
  admin: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  manager: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  staff: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
};

export function UsersManager() {
  const [users, setUsers] = useState<UserProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [roleDialog, setRoleDialog] = useState<UserProfileRow | null>(null);

  async function load() {
    setLoading(true);
    try { setUsers(await listUsers()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);

  const isAdmin = role === "admin";

  if (!isAdmin) {
    return (
      <div className="glass p-10 text-center space-y-2">
        <Shield className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">Only administrators can manage users.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading users…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground">Team Members</h2>
          <p className="text-sm text-muted-foreground">
            Manage who has access and what they can do.
          </p>
        </div>
        <Button onClick={() => setInviteDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Invite
        </Button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => {
          const Icon = ROLE_ICON[r];
          return (
            <div key={r} className="glass-flat p-3 rounded-xl space-y-1">
              <div className="flex items-center gap-2">
                <span className={`h-6 w-6 rounded-lg flex items-center justify-center ${ROLE_COLOR[r]}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <p className="text-sm font-medium text-foreground">{ROLE_LABEL[r]}</p>
              </div>
              <p className="text-[11px] text-muted-foreground">{ROLE_DESC[r]}</p>
            </div>
          );
        })}
      </div>

      {users.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Users className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">No team members yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Invite your manager and delivery staff. They will receive an email to set their password.
          </p>
          <Button onClick={() => setInviteDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Invite first member
          </Button>
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {users.map((u) => {
            const Icon = ROLE_ICON[u.role];
            return (
              <div key={u.id} className="p-4 flex items-center justify-between gap-3 hover:bg-accent/30 transition">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${ROLE_COLOR[u.role]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {u.full_name ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{u.email ?? "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] uppercase tracking-wider rounded px-2 py-0.5 ${ROLE_COLOR[u.role]}`}>
                    {ROLE_LABEL[u.role]}
                  </span>
                  {u.role !== "admin" && (
                    <button
                      onClick={() => setRoleDialog(u)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition flex items-center gap-1 text-xs"
                      title="Change role"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
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

      {roleDialog && (
        <ChangeRoleDialog
          user={roleDialog}
          onOpenChange={(o) => { if (!o) setRoleDialog(null); }}
          onDone={() => { setRoleDialog(null); load(); }}
        />
      )}
    </div>
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setEmail(""); setFullName(""); setSelectedRole("staff"); }
  }, [open]);

  async function save() {
    if (!email.trim() || !fullName.trim()) return;
    setSaving(true);
    try {
      await inviteUser(email.trim().toLowerCase(), fullName.trim(), selectedRole);
      toast.success(`Invite sent to ${email.trim()}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>
            They will receive an email with a link to set their password and log in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Full name *</Label>
            <Input
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ahmed Hassan"
            />
          </div>
          <div className="space-y-2">
            <Label>Email address *</Label>
            <Input
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
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{ROLE_DESC[selectedRole]}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !email.trim() || !fullName.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Change role dialog ───────────────────────────────────────────────────

function ChangeRoleDialog({
  user, onOpenChange, onDone,
}: {
  user: UserProfileRow;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<UserRole>(user.role);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (selectedRole === user.role) { onOpenChange(false); return; }
    setSaving(true);
    try {
      await setUserRole(user.id, selectedRole);
      toast.success(`${user.full_name ?? "User"} is now ${ROLE_LABEL[selectedRole]}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <DialogTitle>Change role</DialogTitle>
          </div>
          <DialogDescription>
            Changing <strong>{user.full_name ?? user.email}</strong>&apos;s role takes effect immediately.
            They will see different screens on their next page load.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>New role</Label>
          <Select value={selectedRole} onValueChange={(v) => v && setSelectedRole(v as UserRole)}>
            <SelectTrigger>
              <SelectValue>{ROLE_LABEL[selectedRole]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manager">{ROLE_LABEL.manager}</SelectItem>
              <SelectItem value="staff">{ROLE_LABEL.staff}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{ROLE_DESC[selectedRole]}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || selectedRole === user.role}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
