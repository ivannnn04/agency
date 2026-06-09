import { createPMServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare, Kanban } from "lucide-react";

export default async function PMProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createPMServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (!project) notFound();

  const { data: taskStats } = await supabase
    .from("tasks")
    .select("status")
    .eq("project_id", id);

  const counts = {
    todo: taskStats?.filter((t) => t.status === "todo").length ?? 0,
    in_progress: taskStats?.filter((t) => t.status === "in_progress").length ?? 0,
    review: taskStats?.filter((t) => t.status === "review").length ?? 0,
    done: taskStats?.filter((t) => t.status === "done").length ?? 0,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const donePercent = total > 0 ? Math.round((counts.done / total) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: project.color }}
          >
            {project.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">{project.name}</h1>
            {project.description && (
              <p className="text-zinc-500 text-sm mt-0.5">{project.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/pm/projects/${id}/tasks`}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-600 px-3 py-2 rounded-lg transition-colors"
          >
            <Kanban size={16} />
            Board
          </Link>
          <Link
            href={`/pm/projects/${id}/chat`}
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-600 px-3 py-2 rounded-lg transition-colors"
          >
            <MessageSquare size={16} />
            Chat
          </Link>
        </div>
      </div>

      <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-zinc-400">Overall progress</span>
          <span className="text-sm font-medium text-white">{donePercent}%</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${donePercent}%`, backgroundColor: project.color }}
          />
        </div>
        <div className="flex gap-6 mt-4">
          {Object.entries(counts).map(([status, count]) => (
            <div key={status}>
              <p className="text-2xl font-semibold text-white">{count}</p>
              <p className="text-xs text-zinc-600 capitalize mt-0.5">{status.replace("_", " ")}</p>
            </div>
          ))}
        </div>
      </div>

      <Link
        href={`/pm/projects/${id}/tasks`}
        className="block bg-[#534AB7]/10 border border-[#534AB7]/30 hover:border-[#534AB7]/50 rounded-xl p-5 transition-colors"
      >
        <p className="text-[#8B7FD4] text-sm font-medium">Open Kanban Board →</p>
        <p className="text-zinc-500 text-xs mt-1">View and manage all tasks in {project.name}</p>
      </Link>
    </div>
  );
}
