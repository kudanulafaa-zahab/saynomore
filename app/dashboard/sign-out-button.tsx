"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      onClick={handleSignOut}
      variant="ghost"
      className="text-white/70 hover:text-white hover:bg-white/5"
    >
      <LogOut className="h-4 w-4 mr-2" />
      Sign out
    </Button>
  );
}
