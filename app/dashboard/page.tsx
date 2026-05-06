import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase-server";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  staff: "Delivery Staff",
};

const ROLE_COLOR: Record<string, string> = {
  admin: "from-indigo-500 to-purple-500",
  manager: "from-blue-500 to-cyan-500",
  staff: "from-emerald-500 to-teal-500",
};

export default async function DashboardPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const role = profile?.role ?? "staff";
  const name = profile?.full_name ?? user.email;

  return (
    <div className="min-h-dvh px-6 py-10 max-w-5xl mx-auto space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-white/40">Welcome back</p>
          <h1 className="text-2xl font-semibold text-white">{name}</h1>
        </div>
        <SignOutButton />
      </div>

      {/* Role badge */}
      <div className="glass-flat rounded-2xl p-5 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-white/40 mb-1">Role</p>
          <p className="text-base text-white">{ROLE_LABEL[role]}</p>
        </div>
        <div
          className={`h-10 w-10 rounded-xl bg-gradient-to-br ${ROLE_COLOR[role]}`}
          style={{ boxShadow: "0 8px 24px rgba(99,102,241,0.30)" }}
        />
      </div>

      {/* Empty state — modules to come */}
      <div className="glass p-10 text-center space-y-3">
        <h2 className="text-lg font-medium text-white">Foundation ready</h2>
        <p className="text-sm text-white/60 max-w-md mx-auto">
          Auth is live. Next we&apos;ll build the Brand &amp; Product catalog,
          then Suppliers, Shipments, Inventory, and Sales.
        </p>
      </div>

      {role !== "admin" && (
        <div className="glass-flat rounded-xl p-4 text-sm text-white/60">
          You&apos;re signed in as <strong className="text-white">{ROLE_LABEL[role]}</strong>.
          Ask the administrator if you need elevated access.
        </div>
      )}
    </div>
  );
}
