import { createPMServerClient } from "@/lib/supabase/server";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, Folder, Play } from "lucide-react";

export default async function PMDashboardPage() {
  const supabase = await createPMServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).single();
  const isAdmin = profile?.role === "admin";

  if (!isAdmin) {
    // Member view — only their data
    const [{ data: projects }, { data: myTasks }, { data: activeLogs }] = await Promise.all([
      supabase.from("pm_projects").select("id, name, color, status").eq("status", "active"),
      supabase
        .from("pm_tasks")
        .select("id, title, status, due_date, project_id, pm_projects(name)")
        .eq("assignee_id", user!.id)
        .not("status", "eq", "completed")
        .order("due_date", { ascending: true }),
      supabase
        .from("pm_time_logs")
        .select("id, task_id, started_at, pm_tasks(title)")
        .eq("user_id", user!.id)
        .is("ended_at", null)
        .limit(1),
    ]);

    const overdue = (myTasks ?? []).filter(
      (t) => t.due_date && new Date(t.due_date) < new Date()
    );

    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">My Dashboard</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "My Projects", value: projects?.length ?? 0, icon: Folder, color: "text-[#534AB7]" },
            { label: "Open Tasks", value: myTasks?.length ?? 0, icon: Clock, color: "text-amber-400" },
            { label: "Overdue", value: overdue.length, icon: AlertCircle, color: "text-red-400" },
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

        {/* Active timer */}
        {(activeLogs ?? []).length > 0 && (
          <div className="bg-[#534AB7]/10 border border-[#534AB7]/30 rounded-xl p-4 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-[#534AB7] animate-pulse" />
            <div>
              <p className="text-sm text-[#8B7FD4] font-medium">Timer running</p>
              <p className="text-xs text-zinc-500">{((activeLogs![0].pm_tasks as unknown) as { title: string } | null)?.title}</p>
            </div>
            <Play size={14} className="text-[#534AB7] ml-auto" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          {/* My projects */}
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-medium text-zinc-400 mb-4">My Projects</h2>
            <div className="space-y-3">
              {(projects ?? []).length === 0 && <p className="text-zinc-600 text-sm">No active projects</p>}
              {(projects ?? []).map((p) => (
                <Link key={p.id} href={`/pm/projects/${p.id}`} className="flex items-center gap-3 group">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-sm text-zinc-300 group-hover:text-white transition-colors truncate">{p.name}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* My tasks */}
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-medium text-zinc-400 mb-4 flex items-center gap-2">
              My Tasks
              {overdue.length > 0 && (
                <span className="bg-red-500/15 text-red-400 text-xs px-2 py-0.5 rounded-full">{overdue.length} overdue</span>
              )}
            </h2>
            <div className="space-y-3">
              {(myTasks ?? []).length === 0 && <p className="text-zinc-600 text-sm">No open tasks</p>}
              {(myTasks ?? []).slice(0, 6).map((t) => {
                const isOverdue = t.due_date && new Date(t.due_date) < new Date();
                return (
                  <div key={t.id} className="flex items-start gap-2">
                    {isOverdue
                      ? <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
                      : <CheckCircle2 size={13} className="text-zinc-700 mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-300 truncate">{t.title}</p>
                      <p className="text-xs text-zinc-600">
                        {((t.pm_projects as unknown) as { name: string } | null)?.name}
                        {t.due_date && ` · due ${formatDistanceToNow(new Date(t.due_date), { addSuffix: true })}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Admin view — full dashboard
  const [{ data: projects }, { data: tasks }, { data: overdueTasks }] = await Promise.all([
    supabase.from("pm_projects").select("*").eq("status", "active"),
    supabase
      .from("pm_tasks")
      .select("*, assignee:profiles(full_name)")
      .in("status", ["todo", "in_progress", "internal_review"])
      .order("due_date", { ascending: true })
      .limit(10),
    supabase
      .from("pm_tasks")
      .select("*, assignee:profiles(full_name)")
      .lt("due_date", new Date().toISOString().split("T")[0])
      .not("status", "eq", "completed"),
  ]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
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
            {projects?.length === 0 && <p className="text-zinc-600 text-sm">No active projects</p>}
            {projects?.map((p) => (
              <Link key={p.id} href={`/pm/projects/${p.id}`} className="flex items-center gap-3 group">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-sm text-zinc-300 group-hover:text-white transition-colors truncate">{p.name}</span>
              </Link>
            ))}
            <Link href="/pm/projects" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">View all →</Link>
          </div>
        </div>

        <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-zinc-400 mb-4 flex items-center gap-2">
            Overdue Tasks
            {(overdueTasks?.length ?? 0) > 0 && (
              <span className="bg-red-500/15 text-red-400 text-xs px-2 py-0.5 rounded-full">{overdueTasks!.length}</span>
            )}
          </h2>
          <div className="space-y-3">
            {overdueTasks?.length === 0 && <p className="text-zinc-600 text-sm">All caught up!</p>}
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
