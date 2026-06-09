"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { PMProfile, PMProject } from "@/types/pm";
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Sparkles,
  ChevronRight,
  Circle,
  TrendingUp,
} from "lucide-react";

interface Props {
  projects: Pick<PMProject, "id" | "name" | "color" | "status">[];
  profile: PMProfile | null;
}

const navItems = [
  { href: "/pm", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pm/projects", label: "Projects", icon: FolderKanban },
  { href: "/pm/team", label: "Team", icon: Users },
  { href: "/pm/ai", label: "AI PM", icon: Sparkles },
];

export default function PMSidebar({ projects, profile }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="w-60 bg-[#141414] border-r border-zinc-800 flex flex-col shrink-0">
      {/* Logo + Space Toggle */}
      <div className="px-4 py-4 border-b border-zinc-800 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[#534AB7] flex items-center justify-center text-white font-bold text-xs">
            G
          </div>
          <span className="text-white font-semibold text-sm">Gudrix PM</span>
        </div>

        {/* Finance / PM toggle — admin only */}
        {profile?.role === "admin" && (
          <div className="flex items-center bg-zinc-900 rounded-lg p-0.5 gap-0.5">
            <Link
              href="/"
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs text-zinc-400 hover:text-white transition-colors"
            >
              <TrendingUp size={12} />
              Finance
            </Link>
            <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs bg-[#534AB7] text-white">
              <FolderKanban size={12} />
              PM
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        <div className="px-3 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = href === "/pm" ? pathname === "/pm" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-[#534AB7]/15 text-[#8B7FD4]"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                )}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Projects list */}
        <div className="mt-5 px-3">
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-xs text-zinc-600 uppercase tracking-wider font-medium">
              Projects
            </span>
            {profile?.role === "admin" && (
              <Link
                href="/pm/projects/new"
                className="text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <ChevronRight size={14} />
              </Link>
            )}
          </div>
          <div className="space-y-0.5">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/pm/projects/${p.id}`}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
                  pathname.startsWith(`/pm/projects/${p.id}`)
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-500 hover:text-white hover:bg-zinc-800/60"
                )}
              >
                <Circle size={8} fill={p.color} stroke={p.color} className="shrink-0" />
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </nav>

      {/* User at bottom */}
      {profile && (
        <div className="px-4 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#534AB7] flex items-center justify-center text-white text-xs font-medium shrink-0">
              {profile.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{profile.full_name}</p>
              <p className="text-xs text-zinc-500 capitalize">{profile.role}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
