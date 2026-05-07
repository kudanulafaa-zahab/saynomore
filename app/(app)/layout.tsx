import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase-server";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const name = profile?.full_name ?? user.email ?? "User";
  const role = profile?.role ?? "staff";

  return (
    <div className="min-h-dvh">
      <Sidebar role={role} />
      <div className="lg:pl-64">
        <Topbar name={name} role={role} />
        <main className="px-4 sm:px-6 py-4 sm:py-6 pb-28 lg:pb-6">{children}</main>
      </div>
      <BottomNav role={role} />
    </div>
  );
}
