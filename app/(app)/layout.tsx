import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase-server";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { OfflineBanner } from "@/components/layout/offline-banner";
import { CommandPalette } from "@/components/layout/command-palette";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServer();

  // Resolve the user without forcing a network round-trip when offline.
  // getUser() validates over the network; if that fails (offline) fall back to
  // the locally stored session so a logged-in user is never bounced to /login.
  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name === "AuthApiError") {
      user = null; // server reached, session invalid → genuinely logged out
    } else if (error) {
      throw error; // network failure → fall through to session fallback
    } else {
      user = data.user;
    }
  } catch {
    const { data: { session } } = await supabase.auth.getSession();
    user = session?.user ?? null;
  }

  if (!user) redirect("/login");

  // Profile lookup can fail offline — degrade gracefully instead of crashing.
  let name = user.email ?? "User";
  let role = "staff";
  try {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.full_name) name = profile.full_name;
    if (profile?.role) role = profile.role;
  } catch {
    /* offline — use fallbacks */
  }

  return (
    <div className="min-h-dvh overflow-x-hidden glass-wallpaper">
      <Sidebar role={role} />
      <Topbar name={name} role={role} />
      <div className="lg:pl-60 relative z-[1]" style={{ paddingTop: "calc(52px + env(safe-area-inset-top, 0px))" }}>
        <OfflineBanner />
        <main className="px-4 py-5 pb-32 lg:pb-10 max-w-5xl mx-auto lg:max-w-none lg:px-10 xl:px-14 2xl:max-w-[1440px] 2xl:mx-auto">
          {children}
        </main>
      </div>
      <BottomNav role={role} />
      <CommandPalette role={role} />
    </div>
  );
}
