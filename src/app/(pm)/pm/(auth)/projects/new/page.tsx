"use client";

import { useState } from "react";
import { createPMClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const COLORS = [
  "#534AB7", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#06B6D4", "#EC4899", "#6366F1",
];

export default function PMNewProjectPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#534AB7");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createPMClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("pm_projects")
      .insert({ name, description, color, owner_id: user?.id })
      .select()
      .single();

    if (!error && data) {
      await supabase
        .from("pm_project_members")
        .insert({ project_id: data.id, user_id: user?.id });
      router.push(`/pm/projects/${data.id}`);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold text-white mb-8">New Project</h1>

      <form onSubmit={handleSubmit} className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-sm text-zinc-400 mb-1.5">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#534AB7] transition-colors"
            placeholder="Website Redesign"
          />
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#534AB7] transition-colors resize-none"
            placeholder="Optional description..."
          />
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-2">Color</label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition-all ${color === c ? "ring-2 ring-white ring-offset-2 ring-offset-[#1a1a1a] scale-110" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex-1 border border-zinc-700 text-zinc-400 hover:text-white py-2.5 rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name}
            className="flex-1 bg-[#534AB7] hover:bg-[#4a42a8] disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Creating..." : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  );
}
