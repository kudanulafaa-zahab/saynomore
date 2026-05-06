"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Search,
  Truck,
  Package,
  CheckCircle2,
  Clock,
  Anchor,
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
  listShipments,
  createShipment,
  nextShipmentRef,
  type ShipmentRow,
  type ShipmentStatus,
} from "@/lib/queries/shipments";
import { listSuppliers, type SupplierRow } from "@/lib/queries/masters";

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  in_transit: "In Transit",
  arrived: "Arrived",
  grn_confirmed: "Locked / Received",
};

const STATUS_COLOR: Record<ShipmentStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  ordered: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  in_transit: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  arrived: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  grn_confirmed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
};

const STATUS_ICON: Record<ShipmentStatus, typeof Truck> = {
  draft: Package,
  ordered: Clock,
  in_transit: Truck,
  arrived: Anchor,
  grn_confirmed: CheckCircle2,
};

export function ShipmentsList() {
  const router = useRouter();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "all">("all");
  const [newDialog, setNewDialog] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [s, sup] = await Promise.all([listShipments(), listSuppliers()]);
      setRows(s);
      setSuppliers(sup);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    const term = q.trim().toLowerCase();
    if (term) {
      r = r.filter((x) => x.reference.toLowerCase().includes(term) || (x.notes ?? "").toLowerCase().includes(term));
    }
    return r;
  }, [rows, statusFilter, q]);

  function supplierName(id: string | null): string {
    if (!id) return "—";
    return suppliers.find((s) => s.id === id)?.name ?? "—";
  }

  if (loading) {
    return (
      <div className="glass p-12 flex flex-col items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Operations</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Shipments</h1>
        </div>
        <Button onClick={() => setNewDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New
        </Button>
      </div>

      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference…"
            className="pl-9 h-11"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[140px] h-11">
            <SelectValue>{statusFilter === "all" ? "All" : STATUS_LABEL[statusFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {(Object.keys(STATUS_LABEL) as ShipmentStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="glass p-10 text-center space-y-3">
          <div
            className="mx-auto h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
          >
            <Truck className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-medium text-foreground">
            {rows.length === 0 ? "No shipments yet" : "No matches"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {rows.length === 0
              ? "Create a shipment when you place an order with your supplier. Add lines as products are confirmed."
              : "Try a different filter."}
          </p>
          {rows.length === 0 && (
            <Button onClick={() => setNewDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create first shipment
            </Button>
          )}
        </div>
      ) : (
        <div className="glass divide-y divide-border overflow-hidden">
          {filtered.map((s) => {
            const Icon = STATUS_ICON[s.status];
            return (
              <Link
                key={s.id}
                href={`/shipments/${s.id}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-accent/30 transition"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${STATUS_COLOR[s.status]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-medium text-foreground">{s.reference}</p>
                    <p className="text-xs text-muted-foreground">
                      {supplierName(s.supplier_id)}
                      {s.notes && <> · {s.notes}</>}
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] uppercase tracking-wider rounded px-2 py-0.5 shrink-0 ${STATUS_COLOR[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <NewShipmentDialog
        open={newDialog}
        suppliers={suppliers}
        existing={rows}
        onOpenChange={setNewDialog}
        onCreated={(id) => {
          setNewDialog(false);
          router.push(`/shipments/${id}`);
        }}
      />
    </div>
  );
}

function NewShipmentDialog({
  open, suppliers, existing, onOpenChange, onCreated,
}: {
  open: boolean;
  suppliers: SupplierRow[];
  existing: ShipmentRow[];
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [reference, setReference] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setReference(nextShipmentRef(existing));
      setSupplierId(suppliers[0]?.id ?? "");
    }
  }, [open, existing, suppliers]);

  async function save() {
    if (!reference.trim()) return;
    setSaving(true);
    try {
      const created = await createShipment({
        reference: reference.trim(),
        supplier_id: supplierId || null,
        status: "draft",
      });
      toast.success("Shipment created");
      onCreated(created.id);
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
          <DialogTitle>New Shipment</DialogTitle>
          <DialogDescription>
            Start in draft. Add lines, lock forex rates, then confirm GRN when goods arrive.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Reference *</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="SH-2026-001" />
            <p className="text-[11px] text-muted-foreground">Auto-generated. Edit if you have your own scheme.</p>
          </div>
          <div className="space-y-2">
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={(v) => v && setSupplierId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pick supplier">
                  {suppliers.find((s) => s.id === supplierId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {suppliers.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                No suppliers yet. Add one first under Suppliers.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !reference.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
