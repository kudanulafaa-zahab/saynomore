"use client";

import { useEffect, useState } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Warehouse, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listGodowns,
  createGodown,
  updateGodown,
  deleteGodown,
  type GodownRow,
  type GodownInput,
} from "@/lib/queries/masters";
import { withOfflineFallback } from "@/lib/offline-write";
import { getCurrentUserRole } from "@/lib/queries/products";

export function GodownsManager() {
  const [rows, setRows] = useState<GodownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; editing?: GodownRow }>({ open: false });
  const [role, setRole] = useState<string | null>(null);
  const [confirmGodown, setConfirmGodown] = useState<{ id: string; name: string } | null>(null);

  async function load() {
    setLoading(true);
    try { setRows(await listGodowns()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { getCurrentUserRole().then(setRole).catch(() => {}); }, []);
  const isAdmin = role === "admin";

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  async function setDefault(id: string) {
    try {
      // Clear current defaults, then set this one
      const current = rows.find((r) => r.is_default);
      if (current && current.id !== id) {
        await updateGodown(current.id, { is_default: false });
      }
      await updateGodown(id, { is_default: true });
      toast.success("Default godown set");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground">Godowns / Warehouses</h2>
          <p className="text-sm text-muted-foreground">
            Where your stock physically sits. Set one as default for quick selection.
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4 mr-2" />
          New
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--glass-bg-2)" }}
          >
            <Warehouse className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-base font-medium text-foreground">No godowns yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Add the warehouses or storage locations where you keep stock. Stock is tracked per-godown.
          </p>
          <Button onClick={() => setDialog({ open: true })}>
            <Plus className="h-4 w-4 mr-2" />
            Create first godown
          </Button>
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {rows.map((g) => (
            <div key={g.id} className="p-4 flex items-center justify-between gap-3 hover:bg-accent/30 transition">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
                >
                  <Warehouse className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="text-base font-medium text-foreground">{g.name}</p>
                    {g.is_default && (
                      <span className="inline-flex items-center gap-1 text-[12px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        <Star className="h-2.5 w-2.5" /> Default
                      </span>
                    )}
                  </div>
                  {g.location && <p className="text-xs text-muted-foreground">{g.location}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!g.is_default && (
                  <button
                    onClick={() => setDefault(g.id)}
                    className="p-2 rounded-lg text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition"
                    title="Make default"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => setDialog({ open: true, editing: g })}
                  className="p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-secondary transition"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setConfirmGodown({ id: g.id, name: g.name })}
                    className="p-2 rounded-lg text-muted-foreground/70 hover:text-[var(--snm-error)] hover:bg-[color-mix(in_srgb,var(--snm-error)_10%,transparent)] transition"
                    title="Delete (admin)"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <GodownDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(o) => setDialog({ open: o })}
        onSaved={load}
      />

      <ConfirmSheet
        open={confirmGodown !== null}
        onClose={() => setConfirmGodown(null)}
        title="Delete godown?"
        message={confirmGodown ? `"${confirmGodown.name}" will be deleted. Only works if no stock is in it.` : ""}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmGodown) return;
          try { await deleteGodown(confirmGodown.id); toast.success("Deleted"); setConfirmGodown(null); load(); }
          catch (e) { toast.error((e as Error).message); }
        }}
      />
    </div>
  );
}

function GodownDialog({
  open, editing, onOpenChange, onSaved,
}: {
  open: boolean;
  editing?: GodownRow;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setLocation(editing?.location ?? "");
    }
  }, [open, editing]);

  async function save() {
    if (!name.trim()) return;
    const payload: GodownInput = {
      name: name.trim(),
      location: location.trim() || null,
    };
    setSaving(true);
    try {
      const { queued } = await withOfflineFallback(
        () => editing ? updateGodown(editing.id, payload) : createGodown(payload),
        editing
          ? { table: "godowns", action: "update", payload: payload as unknown as Record<string, unknown>, match: { id: editing.id } }
          : { table: "godowns", action: "insert", payload: payload as unknown as Record<string, unknown> },
      );
      toast.success(queued ? "Saved offline — will sync when connected" : editing ? "Saved" : "Godown created");
      if (!queued) { onOpenChange(false); onSaved(); }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Godown" : "New Godown"}</DialogTitle>
          <DialogDescription>Where stock is physically stored.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" />
          </div>
          <div className="space-y-2">
            <Label>Location / Address</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
