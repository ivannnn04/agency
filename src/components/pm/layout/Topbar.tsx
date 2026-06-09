"use client";

import { createPMClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { PMProfile } from "@/types/pm";
import { Bell, LogOut } from "lucide-react";

interface Props {
  profile: PMProfile | null;
}

export default function PMTopbar({ profile }: Props) {
  const router = useRouter();
  const supabase = createPMClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/pm/login");
    router.refresh();
  }

  return (
    <header className="h-14 border-b border-zinc-800 bg-[#141414] flex items-center justify-between px-6 shrink-0">
      <div />
      <div className="flex items-center gap-3">
        <button className="text-zinc-500 hover:text-white transition-colors p-1">
          <Bell size={18} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#534AB7] flex items-center justify-center text-white text-xs font-medium">
            {profile?.full_name.charAt(0).toUpperCase() ?? "?"}
          </div>
          <span className="text-sm text-zinc-300">{profile?.full_name}</span>
        </div>
        <button
          onClick={handleLogout}
          className="text-zinc-500 hover:text-white transition-colors p-1"
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
