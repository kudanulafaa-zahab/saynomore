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

const CARD = {
  background: "rgba(18,19,23,0.70)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};
const CARD_L2 = {
  background: "rgba(28,27,27,0.85)",
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
  boxShadow: "0 40px 60px -15px rgba(0,0,0,0.5)",
};

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

  // Alert toggles (local state — no DB backing needed for display)
  const [alerts, setAlerts] = useState<Record<string, boolean>>({ low_stock: true, wholesale: true, route_latency: false });

  // Sheet states
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(255,255,255,0.05)",
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    color: "#ffffff",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    color: "#8e9192",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 6,
    display: "block",
  };

  if (loading) {
    return (
      <div style={{ background: "#000000", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#8e9192" }} />
      </div>
    );
  }

  return (
    <div style={{ background: "#000000", minHeight: "100vh", padding: "0 0 120px 0" }}>
      {/* Header */}
      <section style={{ marginBottom: 32 }}>
        <h1 style={{ color: "#ffffff", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: "34px" }}>
          Settings &amp; Security
        </h1>
        <p style={{ color: "#8e9192", fontSize: 14, marginTop: 6 }}>
          Manage your enterprise architecture and security protocols.
        </p>
      </section>

      {/* Bento grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>

        {/* Roles & Permissions — col 8 */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, gridColumn: "span 8" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="material-symbols-outlined" style={{ color: "#ffffff" }}>admin_panel_settings</span>
              <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Roles &amp; Permissions</h2>
            </div>
            {isAdmin && (
              <button
                onClick={() => setInviteSheet(true)}
                style={{ background: "rgba(255,255,255,0.10)", color: "#ffffff", border: "none", borderRadius: 999, padding: "8px 18px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}
              >
                Invite Member
              </button>
            )}
          </div>

          {/* Role legend */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
            {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
              <div key={r} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className="material-symbols-outlined" style={{ color: "#c4c7c8", fontSize: 16 }}>{ROLE_ICON[r]}</span>
                  <span style={{ color: "#e5e2e1", fontSize: 13, fontWeight: 500 }}>{ROLE_LABEL[r]}</span>
                </div>
                <p style={{ color: "#8e9192", fontSize: 11 }}>{ROLE_DESC[r]}</p>
              </div>
            ))}
          </div>

          {/* User rows */}
          {!isAdmin ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <p style={{ color: "#8e9192", fontSize: 14 }}>Only administrators can manage users.</p>
            </div>
          ) : users.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <p style={{ color: "#8e9192", fontSize: 14 }}>No team members yet.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {users.map((u) => {
                const isMe = u.id === myId;
                return (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "rgba(255,255,255,0.04)", borderRadius: 10, borderLeft: u.role === "admin" ? "2px solid #ffffff" : "2px solid transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span className="material-symbols-outlined" style={{ color: u.role === "admin" ? "#ffffff" : "#8e9192", fontSize: 20 }}>{ROLE_ICON[u.role]}</span>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <p style={{ color: "#e5e2e1", fontSize: 15, fontWeight: 500 }}>{u.full_name ?? "—"}</p>
                          {isMe && <span style={{ background: "rgba(255,255,255,0.1)", color: "#c7c6cb", borderRadius: 4, padding: "1px 8px", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}>YOU</span>}
                        </div>
                        <p style={{ color: "#8e9192", fontSize: 12 }}>{u.email ?? "—"}</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ background: "rgba(255,255,255,0.08)", color: "#c4c7c8", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 500, letterSpacing: "0.06em" }}>
                        {ROLE_LABEL[u.role]}
                      </span>
                      {!isMe && (
                        <>
                          <button onClick={() => setEditUserSheet(u)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 6 }}>
                            <span className="material-symbols-outlined" style={{ color: "#8e9192", fontSize: 16 }}>edit</span>
                          </button>
                          <button onClick={() => setDeleteUserTarget(u)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 6 }}>
                            <span className="material-symbols-outlined" style={{ color: "#8e9192", fontSize: 16 }}>delete</span>
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

        {/* Integrations — col 4 */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, gridColumn: "span 4", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span className="material-symbols-outlined" style={{ color: "#ffffff" }}>hub</span>
              <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Integrations</h2>
            </div>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 20, marginBottom: 16, position: "relative", overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ color: "#8e9192", fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase" }}>WhatsApp API</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 999, background: "#4ade80", boxShadow: "0 0 8px rgba(74,222,128,0.5)" }} />
                  <span style={{ color: "#4ade80", fontSize: 10, fontWeight: 700 }}>ACTIVE</span>
                </div>
              </div>
              <p style={{ color: "#e5e2e1", fontSize: 14, marginBottom: 4 }}>Connected to <strong>+960 900...</strong></p>
              <p style={{ color: "#8e9192", fontSize: 12 }}>Last handshake: 2m ago</p>
              <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 2, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)" }} />
            </div>
          </div>
          <button style={{ width: "100%", background: "#ffffff", color: "#2f3131", border: "none", borderRadius: 10, padding: "14px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            Sync Handshake
          </button>
        </div>

        {/* Currency Rates — col 6 */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, gridColumn: "span 6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <span className="material-symbols-outlined" style={{ color: "#ffffff" }}>currency_exchange</span>
            <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Base Currency Rates</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {[{ code: "IDR", name: "Indonesian Rupiah", rate: "15,642.00" }, { code: "MVR", name: "Maldivian Rufiyaa", rate: "15.40" }].map((c) => (
              <div key={c.code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 999, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontSize: 11, fontWeight: 700 }}>{c.code}</div>
                  <span style={{ color: "#e5e2e1", fontSize: 16 }}>{c.name}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>{c.rate}</span>
                  <p style={{ color: "#8e9192", fontSize: 12 }}>Per 1 USD</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <p style={{ color: "#8e9192", fontSize: 12, fontStyle: "italic" }}>Auto-refresh via exchange rate API every 6 hours.</p>
          </div>
        </div>

        {/* Stock & System Alerts — col 6 */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, gridColumn: "span 6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <span className="material-symbols-outlined" style={{ color: "#ffffff" }}>notifications_active</span>
            <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Stock &amp; System Alerts</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {ALERT_TOGGLES.map((a) => (
              <div key={a.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ color: "#ffffff", fontSize: 16, marginBottom: 2 }}>{a.label}</p>
                  <p style={{ color: "#8e9192", fontSize: 12 }}>{a.desc}</p>
                </div>
                <button
                  onClick={() => setAlerts((prev) => ({ ...prev, [a.key]: !prev[a.key] }))}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 999,
                    background: alerts[a.key] ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.1)",
                    border: "none",
                    cursor: "pointer",
                    position: "relative",
                    flexShrink: 0,
                    transition: "background 0.2s",
                  }}
                >
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: "#ffffff",
                    position: "absolute",
                    top: 2,
                    left: alerts[a.key] ? 22 : 2,
                    transition: "left 0.2s",
                  }} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Godowns — col 12 */}
        <div style={{ ...CARD, borderRadius: 16, padding: 24, gridColumn: "span 12" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="material-symbols-outlined" style={{ color: "#ffffff" }}>warehouse</span>
              <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Godowns / Warehouses</h2>
            </div>
            <button
              onClick={() => setGodownSheet({ open: true })}
              style={{ background: "rgba(255,255,255,0.10)", color: "#ffffff", border: "none", borderRadius: 999, padding: "8px 18px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}
            >
              + New
            </button>
          </div>
          {godowns.length === 0 ? (
            <p style={{ color: "#8e9192", fontSize: 14 }}>No godowns yet. Add the warehouses where you keep stock.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
              {godowns.map((g) => (
                <div key={g.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="material-symbols-outlined" style={{ color: "#c4c7c8", fontSize: 20 }}>warehouse</span>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <p style={{ color: "#e5e2e1", fontSize: 14, fontWeight: 500 }}>{g.name}</p>
                        {g.is_default && <span style={{ background: "rgba(255,255,255,0.1)", color: "#c7c6cb", borderRadius: 4, padding: "1px 8px", fontSize: 10 }}>DEFAULT</span>}
                      </div>
                      {g.location && <p style={{ color: "#8e9192", fontSize: 12 }}>{g.location}</p>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {!g.is_default && (
                      <button onClick={() => setDefaultGodown(g.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                        <span className="material-symbols-outlined" style={{ color: "#8e9192", fontSize: 16 }}>star</span>
                      </button>
                    )}
                    <button onClick={() => setGodownSheet({ open: true, editing: g })} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                      <span className="material-symbols-outlined" style={{ color: "#8e9192", fontSize: 16 }}>edit</span>
                    </button>
                    {isAdmin && (
                      <button onClick={() => setDeleteGodownTarget(g)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                        <span className="material-symbols-outlined" style={{ color: "#8e9192", fontSize: 16 }}>delete</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Enterprise Security — col 12 */}
        <div style={{ ...CARD, borderRadius: 16, padding: 32, gridColumn: "span 12", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <div style={{ maxWidth: 640 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span className="material-symbols-outlined" style={{ color: "#ffffff", fontSize: 28 }}>shield_with_heart</span>
                <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Enterprise Security Core</h2>
              </div>
              <p style={{ color: "#c4c7c8", fontSize: 16, lineHeight: "24px" }}>
                SayNoMore ERP utilizes end-to-end AES-256 encryption for all database handshakes. Your data integrity is monitored by real-time heuristic analysis.
              </p>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button style={{ background: "#ffffff", color: "#2f3131", border: "none", borderRadius: 10, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                Download Audit Log
              </button>
              <button style={{ background: "rgba(255,255,255,0.05)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                View Access Keys
              </button>
            </div>
          </div>
          {/* Glow orb */}
          <div style={{ position: "absolute", right: -80, top: -80, width: 256, height: 256, background: "rgba(255,255,255,0.04)", borderRadius: 999, filter: "blur(80px)", pointerEvents: "none" }} />
        </div>
      </div>

      {/* ── Invite Sheet ── */}
      {inviteSheet && (
        <InviteSheet
          onClose={() => setInviteSheet(false)}
          onDone={() => { setInviteSheet(false); load(); }}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
        />
      )}

      {/* ── Edit User Sheet ── */}
      {editUserSheet && (
        <EditUserSheet
          user={editUserSheet}
          onClose={() => setEditUserSheet(null)}
          onDone={() => { setEditUserSheet(null); load(); }}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
        />
      )}

      {/* ── Delete User confirm ── */}
      {deleteUserTarget && (
        <ConfirmSheet
          title="Remove team member?"
          body={`${deleteUserTarget.full_name ?? deleteUserTarget.email} will lose all access immediately.`}
          danger
          loading={deletingUser}
          onCancel={() => setDeleteUserTarget(null)}
          onConfirm={async () => {
            setDeletingUser(true);
            try {
              await deleteUser(deleteUserTarget.id);
              toast.success(`${deleteUserTarget.full_name ?? "User"} removed`);
              setDeleteUserTarget(null);
              load();
            } catch (e) { toast.error((e as Error).message); }
            finally { setDeletingUser(false); }
          }}
        />
      )}

      {/* ── Godown Sheet ── */}
      {godownSheet.open && (
        <GodownSheet
          editing={godownSheet.editing}
          onClose={() => setGodownSheet({ open: false })}
          onDone={() => { setGodownSheet({ open: false }); load(); }}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
        />
      )}

      {/* ── Delete Godown confirm ── */}
      {deleteGodownTarget && (
        <ConfirmSheet
          title="Delete godown?"
          body={`"${deleteGodownTarget.name}" will be permanently removed. Only works if no stock is in it.`}
          danger
          loading={deletingGodown}
          onCancel={() => setDeleteGodownTarget(null)}
          onConfirm={async () => {
            setDeletingGodown(true);
            try {
              await deleteGodown(deleteGodownTarget.id);
              toast.success("Deleted");
              setDeleteGodownTarget(null);
              load();
            } catch (e) { toast.error((e as Error).message); }
            finally { setDeletingGodown(false); }
          }}
        />
      )}
    </div>
  );
}

// ── Invite Sheet ────────────────────────────────────────────────────────────

function InviteSheet({ onClose, onDone, inputStyle, labelStyle }: {
  onClose: () => void;
  onDone: () => void;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
}) {
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
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Full Name *</label>
        <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Ahmed Hassan" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Email Address *</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ahmed@example.com" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 28 }}>
        <label style={labelStyle}>Role *</label>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} style={{ ...inputStyle, appearance: "none" }}>
          <option value="manager" style={{ background: "#1c1b1b" }}>Manager</option>
          <option value="staff" style={{ background: "#1c1b1b" }}>Delivery Staff</option>
        </select>
        <p style={{ color: "#8e9192", fontSize: 12, marginTop: 6 }}>{ROLE_DESC[role]}</p>
      </div>
      <SheetActions
        onCancel={onClose}
        onConfirm={save}
        disabled={saving || !email.trim() || !fullName.trim()}
        label={saving ? "Sending…" : "SEND INVITE"}
      />
    </Sheet>
  );
}

// ── Edit User Sheet ─────────────────────────────────────────────────────────

function EditUserSheet({ user, onClose, onDone, inputStyle, labelStyle }: {
  user: UserProfileRow;
  onClose: () => void;
  onDone: () => void;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
}) {
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
      <p style={{ color: "#8e9192", fontSize: 12, marginBottom: 20 }}>{user.email}</p>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Full Name *</label>
        <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} />
      </div>
      {user.role !== "admin" && (
        <div style={{ marginBottom: 28 }}>
          <label style={labelStyle}>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} style={{ ...inputStyle, appearance: "none" }}>
            <option value="manager" style={{ background: "#1c1b1b" }}>Manager</option>
            <option value="staff" style={{ background: "#1c1b1b" }}>Delivery Staff</option>
          </select>
          <p style={{ color: "#8e9192", fontSize: 12, marginTop: 6 }}>{ROLE_DESC[role]}</p>
        </div>
      )}
      <SheetActions
        onCancel={onClose}
        onConfirm={save}
        disabled={saving || !fullName.trim()}
        label={saving ? "Saving…" : "SAVE CHANGES"}
      />
    </Sheet>
  );
}

// ── Godown Sheet ────────────────────────────────────────────────────────────

function GodownSheet({ editing, onClose, onDone, inputStyle, labelStyle }: {
  editing?: GodownRow;
  onClose: () => void;
  onDone: () => void;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
}) {
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
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Name *</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 28 }}>
        <label style={labelStyle}>Location / Address</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" style={inputStyle} />
      </div>
      <SheetActions
        onCancel={onClose}
        onConfirm={save}
        disabled={saving || !name.trim()}
        label={saving ? "Saving…" : editing ? "SAVE CHANGES" : "CREATE GODOWN"}
      />
    </Sheet>
  );
}

// ── Confirm Sheet ───────────────────────────────────────────────────────────

function ConfirmSheet({ title, body, danger, loading, onCancel, onConfirm }: {
  title: string;
  body: string;
  danger?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "rgba(28,27,27,0.95)", backdropFilter: "blur(30px)", borderRadius: 20, padding: 28, width: 360, maxWidth: "90vw" }}>
        <p style={{ color: "#ffffff", fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</p>
        <p style={{ color: "#8e9192", fontSize: 14, marginBottom: 24 }}>{body}</p>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onCancel} style={{ flex: 1, background: "rgba(255,255,255,0.05)", color: "#c7c6cb", border: "none", borderRadius: 999, padding: 12, fontSize: 14, cursor: "pointer" }}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              flex: 1,
              background: danger ? "rgba(255,180,171,0.15)" : "#ffffff",
              color: danger ? "#ffb4ab" : "#2f3131",
              border: "none",
              borderRadius: 999,
              padding: 12,
              fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "Loading…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared Sheet wrapper ────────────────────────────────────────────────────

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "rgba(28,27,27,0.95)", backdropFilter: "blur(30px)", borderRadius: "20px 20px 0 0", width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 28 }}>
        <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 999, margin: "0 auto 24px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 999, width: 36, height: 36, cursor: "pointer", color: "#8e9192", fontSize: 20 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SheetActions({ onCancel, onConfirm, disabled, label }: {
  onCancel: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <button onClick={onCancel} style={{ flex: 1, background: "rgba(255,255,255,0.05)", color: "#c7c6cb", border: "none", borderRadius: 999, padding: 14, fontSize: 14, cursor: "pointer" }}>Cancel</button>
      <button
        onClick={onConfirm}
        disabled={disabled}
        style={{ flex: 2, background: "#ffffff", color: "#2f3131", border: "none", borderRadius: 999, padding: 14, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}
      >
        {label}
      </button>
    </div>
  );
}
