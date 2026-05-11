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
    <div className="min-h-dvh" style={{ background: "var(--background)" }}>
      <Sidebar role={role} />
      <Topbar name={name} role={role} />
      {/* pt-[52px] = fixed header height; pb-24 = bottom nav clearance on mobile */}
      <div className="lg:pl-60 pt-[52px]">
        <main className="px-4 py-5 pb-28 lg:pb-8 max-w-5xl mx-auto lg:max-w-none">
          {children}
        </main>
      </div>
      <BottomNav role={role} />
    </div>
  );
}
