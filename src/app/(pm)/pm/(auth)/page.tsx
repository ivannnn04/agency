import { createPMServerClient } from "@/lib/supabase/server";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, Folder } from "lucide-react";

export default async function PMDashboardPage() {
  const supabase = await createPMServerClient();

  const [{ data: projects }, { data: tasks }, { data: overdueTasks }] =
    await Promise.all([
      supabase.from("pm_projects").select("*").eq("status", "active"),
      supabase
        .from("pm_tasks")
        .select("*, assignee:profiles(full_name)")
        .in("status", ["todo", "in_progress", "review"])
        .order("due_date", { ascending: true })
        .limit(10),
      supabase
        .from("pm_tasks")
        .select("*, assignee:profiles(full_name)")
        .lt("due_date", new Date().toISOString().split("T")[0])
        .not("status", "eq", "done"),
    ]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Active Projects", value: projects?.length ?? 0, icon: Folder, color: "text-[#534AB7]" },
          { label: "Open Tasks", value: tasks?.length ?? 0, icon: Clock, color: "text-amber-400" },
          { label: "Overdue", value: overdueTasks?.length ?? 0, icon: AlertCircle, color: "text-red-400" },
          { label: "Done Today", value: 0, icon: CheckCircle2, color: "text-green-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-zinc-500">{label}</span>
              <Icon size={18} className={color} />
            </div>
            <p className="text-3xl font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-zinc-400 mb-4">Active Projects</h2>
          <div className="space-y-3">
            {projects?.length === 0 && (
              <p className="text-zinc-600 text-sm">No active projects</p>
            )}
            {projects?.map((p) => (
              <Link key={p.id} href={`/pm/projects/${p.id}`} className="flex items-center gap-3 group">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-sm text-zinc-300 group-hover:text-white transition-colors truncate">
                  {p.name}
                </span>
              </Link>
            ))}
            <Link href="/pm/projects" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
              View all →
            </Link>
          </div>
        </div>

        <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-zinc-400 mb-4 flex items-center gap-2">
            Overdue Tasks
            {(overdueTasks?.length ?? 0) > 0 && (
              <span className="bg-red-500/15 text-red-400 text-xs px-2 py-0.5 rounded-full">
                {overdueTasks!.length}
              </span>
            )}
          </h2>
          <div className="space-y-3">
            {overdueTasks?.length === 0 && (
              <p className="text-zinc-600 text-sm">All caught up!</p>
            )}
            {overdueTasks?.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-start gap-3">
                <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-zinc-300 truncate">{t.title}</p>
                  <p className="text-xs text-zinc-600">
                    due {formatDistanceToNow(new Date(t.due_date), { addSuffix: true })}
                    {t.assignee && ` · ${(t.assignee as { full_name: string }).full_name}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
