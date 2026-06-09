import { createPMServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function PMProjectsPage() {
  const supabase = await createPMServerClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("*, owner:profiles(full_name)")
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Projects</h1>
          <p className="text-zinc-500 text-sm mt-1">{projects?.length ?? 0} total</p>
        </div>
        <Link
          href="/pm/projects/new"
          className="flex items-center gap-2 bg-[#534AB7] hover:bg-[#4a42a8] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Project
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {projects?.map((p) => (
          <Link
            key={p.id}
            href={`/pm/projects/${p.id}`}
            className="bg-[#1a1a1a] border border-zinc-800 hover:border-zinc-700 rounded-xl p-5 transition-colors group"
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-semibold text-sm"
                style={{ backgroundColor: p.color + "30", color: p.color }}
              >
                {p.name.charAt(0)}
              </div>
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  p.status === "active"
                    ? "bg-green-500/10 text-green-400"
                    : p.status === "paused"
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {p.status}
              </span>
            </div>
            <h3 className="text-white font-medium text-sm mb-1 group-hover:text-[#8B7FD4] transition-colors">
              {p.name}
            </h3>
            {p.description && (
              <p className="text-zinc-500 text-xs line-clamp-2">{p.description}</p>
            )}
          </Link>
        ))}

        {(!projects || projects.length === 0) && (
          <div className="col-span-3 text-center py-16 text-zinc-600">
            <p className="text-lg mb-2">No projects yet</p>
            <Link href="/pm/projects/new" className="text-[#534AB7] hover:text-[#8B7FD4] transition-colors text-sm">
              Create your first project →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
