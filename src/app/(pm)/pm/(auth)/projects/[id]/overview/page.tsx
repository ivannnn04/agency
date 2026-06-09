import { createPMServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare, Kanban, TrendingUp, Clock } from "lucide-react";
import ProjectMembersSection from "@/components/pm/projects/ProjectMembersSection";
import type { PMProfile } from "@/types/pm";

export default async function PMProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createPMServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", user!.id).single();
  const isAdmin = callerProfile?.role === "admin";

  const { data: project } = await supabase.from("pm_projects").select("*").eq("id", id).single();
  if (!project) notFound();

  const [{ data: taskStats }, { data: timeLogs }, { data: memberRows }, { data: allProfiles }] =
    await Promise.all([
      supabase.from("pm_tasks").select("status").eq("project_id", id),
      supabase
        .from("pm_time_logs")
        .select("duration_s, pm_tasks!inner(project_id)")
        .eq("pm_tasks.project_id", id)
        .not("ended_at", "is", null),
      supabase
        .from("pm_project_members")
        .select("user_id, profile:profiles(id, full_name, avatar_url, role, hourly_rate_usd, created_at)")
        .eq("project_id", id),
      supabase.from("profiles").select("id, full_name, avatar_url, role, hourly_rate_usd, created_at").order("full_name"),
    ]);

  let financeProjectName: string | null = null;
  if (project.finance_project_id) {
    const { data: fp } = await supabase.from("projects").select("name").eq("id", project.finance_project_id).single();
    financeProjectName = fp?.name ?? null;
  }

  const members = (memberRows ?? [])
    .map((r) => r.profile as unknown as PMProfile & { email?: string })
    .filter(Boolean);

  const statusList = ["todo", "in_progress", "internal_review", "blocked", "ready_for_report", "to_be_invoiced", "completed"] as const;
  const counts = Object.fromEntries(statusList.map((s) => [s, taskStats?.filter((t) => t.status === s).length ?? 0]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const completed = counts.completed ?? 0;
  const donePercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const totalHours = ((timeLogs ?? []).reduce((s, l) => s + (l.duration_s ?? 0), 0) / 3600).toFixed(1);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: project.color }}>
            {project.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">{project.name}</h1>
            {project.description && <p className="text-zinc-500 text-sm mt-0.5">{project.description}</p>}
            {financeProjectName && (
              <div className="flex items-center gap-1.5 mt-1">
                <TrendingUp size={12} className="text-teal-400" />
                <span className="text-xs text-teal-400">Linked: {financeProjectName}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/pm/projects/${id}/tasks`}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-600 px-3 py-2 rounded-lg transition-colors">
            <Kanban size={16} /> Board
          </Link>
          <Link href={`/pm/projects/${id}/chat`}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-600 px-3 py-2 rounded-lg transition-colors">
            <MessageSquare size={16} /> Chat
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-zinc-400">Overall progress</span>
            <span className="text-sm font-medium text-white">{donePercent}%</span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${donePercent}%`, backgroundColor: project.color }} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
            {statusList.map((s) => (counts[s] ?? 0) > 0 && (
              <div key={s}>
                <p className="text-2xl font-semibold text-white">{counts[s]}</p>
                <p className="text-xs text-zinc-600 mt-0.5">{s.replace(/_/g, " ")}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5 flex flex-col justify-center items-center">
          <Clock size={20} className="text-[#534AB7] mb-2" />
          <p className="text-3xl font-semibold text-white">{totalHours}h</p>
          <p className="text-xs text-zinc-500 mt-1">Total tracked</p>
        </div>
      </div>

      {/* Members */}
      <ProjectMembersSection
        projectId={id}
        members={members}
        allProfiles={(allProfiles ?? []) as (PMProfile & { email?: string })[]}
        isAdmin={isAdmin}
        ownerId={project.owner_id}
      />

      <Link href={`/pm/projects/${id}/tasks`}
        className="block bg-[#534AB7]/10 border border-[#534AB7]/30 hover:border-[#534AB7]/50 rounded-xl p-5 transition-colors">
        <p className="text-[#8B7FD4] text-sm font-medium">Open Kanban Board →</p>
        <p className="text-zinc-500 text-xs mt-1">View and manage all tasks in {project.name}</p>
      </Link>
    </div>
  );
}
