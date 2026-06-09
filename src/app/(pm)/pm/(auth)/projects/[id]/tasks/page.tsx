import { createPMServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import PMTaskBoard from "@/components/pm/tasks/TaskBoard";

export default async function PMTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createPMServerClient();

  const [{ data: project }, { data: tasks }, { data: members }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase
      .from("tasks")
      .select("*, assignee:profiles(id, full_name, avatar_url)")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_members")
      .select("user_id, profile:profiles(id, full_name, avatar_url)")
      .eq("project_id", id),
  ]);

  if (!project) notFound();

  type MemberProfile = { id: string; full_name: string; avatar_url: string | null };
  const profiles = (members ?? []).flatMap((m) => {
    const p = m.profile as unknown as MemberProfile | MemberProfile[] | null;
    if (!p) return [];
    return Array.isArray(p) ? p : [p];
  });

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-xl font-semibold text-white">{project.name}</h1>
        <p className="text-zinc-500 text-sm mt-1">Kanban Board</p>
      </div>
      <PMTaskBoard
        projectId={id}
        initialTasks={tasks ?? []}
        members={profiles as { id: string; full_name: string; avatar_url: string | null }[]}
      />
    </div>
  );
}
