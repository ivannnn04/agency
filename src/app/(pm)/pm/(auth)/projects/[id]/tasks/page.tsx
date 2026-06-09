import { createPMServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import PMTaskBoard from "@/components/pm/tasks/TaskBoard";
import { LayoutDashboard } from "lucide-react";

export default async function PMTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createPMServerClient();

  const [{ data: project }, { data: tasks }, { data: members }, { data: { user } }] = await Promise.all([
    supabase.from("pm_projects").select("*").eq("id", id).single(),
    supabase
      .from("pm_tasks")
      .select("*, assignee:profiles(id, full_name, avatar_url)")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("pm_project_members")
      .select("user_id, profile:profiles(id, full_name, avatar_url)")
      .eq("project_id", id),
    supabase.auth.getUser(),
  ]);

  if (!project) notFound();

  const { data: callerProfile } = await supabase
    .from("profiles").select("role").eq("id", user!.id).single();
  const isAdmin = callerProfile?.role === "admin";

  type MemberProfile = { id: string; full_name: string; avatar_url: string | null };
  const profiles = (members ?? []).flatMap((m) => {
    const p = m.profile as unknown as MemberProfile | MemberProfile[] | null;
    if (!p) return [];
    return Array.isArray(p) ? p : [p];
  });

  return (
    <div className="h-full flex flex-col">
      <div className="mb-5 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{project.name}</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Kanban Board</p>
        </div>
        {isAdmin && (
          <Link
            href={`/pm/projects/${id}/overview`}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-600 px-3 py-2 rounded-lg transition-colors"
          >
            <LayoutDashboard size={15} /> Overview
          </Link>
        )}
      </div>
      <PMTaskBoard
        projectId={id}
        initialTasks={tasks ?? []}
        members={profiles as MemberProfile[]}
        currentUserId={user?.id ?? ""}
      />
    </div>
  );
}
