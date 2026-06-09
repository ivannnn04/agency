"use client";

import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import type { PMProfile } from "@/types/pm";

interface Props {
  projectId: string;
  members: (PMProfile & { email?: string })[];
  allProfiles: (PMProfile & { email?: string })[];
  isAdmin: boolean;
  ownerId: string;
}

export default function ProjectMembersSection({ projectId, members: initial, allProfiles, isAdmin, ownerId }: Props) {
  const [members, setMembers] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nonMembers = allProfiles.filter((p) => !members.find((m) => m.id === p.id));

  async function addMember() {
    if (!selectedUserId) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/pm/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: selectedUserId }),
    });
    const json = await res.json();
    if (json.error) { setError(json.error); setLoading(false); return; }
    const added = allProfiles.find((p) => p.id === selectedUserId)!;
    setMembers((prev) => [...prev, added]);
    setSelectedUserId("");
    setAdding(false);
    setLoading(false);
  }

  async function removeMember(userId: string) {
    if (userId === ownerId) return;
    setLoading(true);
    const res = await fetch(`/api/pm/projects/${projectId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const json = await res.json();
    if (!json.error) setMembers((prev) => prev.filter((m) => m.id !== userId));
    setLoading(false);
  }

  return (
    <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-zinc-400">Members ({members.length})</h2>
        {isAdmin && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs text-[#8B7FD4] hover:text-[#534AB7] transition-colors"
          >
            <UserPlus size={13} /> Add
          </button>
        )}
      </div>

      {adding && (
        <div className="flex gap-2 mb-4">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
          >
            <option value="">Select team member…</option>
            {nonMembers.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
          <button
            onClick={addMember}
            disabled={!selectedUserId || loading}
            className="bg-[#534AB7] hover:bg-[#4a42a8] disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => { setAdding(false); setSelectedUserId(""); }}
            className="text-zinc-500 hover:text-white px-2 py-2 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full pl-1 pr-2 py-1 group"
          >
            <div className="w-6 h-6 rounded-full bg-[#534AB7] flex items-center justify-center text-white text-[10px] font-medium shrink-0">
              {m.full_name.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs text-zinc-300">{m.full_name}</span>
            {isAdmin && m.id !== ownerId && (
              <button
                onClick={() => removeMember(m.id)}
                className="ml-0.5 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
