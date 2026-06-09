"use client";

import { useState, useEffect } from "react";
import { createPMClient } from "@/lib/supabase/client";
import type { PMProfile } from "@/types/pm";
import { Check, Pencil, X } from "lucide-react";

export default function PMTeamPage() {
  const [profiles, setProfiles] = useState<PMProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [saving, setSaving] = useState(false);
  const supabase = createPMClient();

  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data }) => {
        setProfiles((data as PMProfile[]) ?? []);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(p: PMProfile) {
    setEditingId(p.id);
    setRateInput(p.hourly_rate_usd ? String(p.hourly_rate_usd) : "");
  }

  function cancelEdit() {
    setEditingId(null);
    setRateInput("");
  }

  async function saveRate(profileId: string) {
    setSaving(true);
    const rate = rateInput ? Number(rateInput) : 0;
    const { error } = await supabase
      .from("profiles")
      .update({ hourly_rate_usd: rate })
      .eq("id", profileId);
    if (!error) {
      setProfiles((prev) =>
        prev.map((p) => (p.id === profileId ? { ...p, hourly_rate_usd: rate } : p))
      );
    }
    setSaving(false);
    setEditingId(null);
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-white mb-8">Team</h1>
        <p className="text-zinc-500 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Team</h1>
        <p className="text-zinc-500 text-sm mt-1">{profiles.length} members</p>
      </div>

      <div className="space-y-2">
        {profiles.map((p) => (
          <div
            key={p.id}
            className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-4 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-full bg-[#534AB7] flex items-center justify-center text-white font-medium shrink-0">
              {p.full_name.charAt(0).toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-white font-medium">{p.full_name}</p>
              <p className="text-zinc-500 text-sm capitalize">{p.role}</p>
            </div>

            {/* Hourly rate */}
            <div className="flex items-center gap-2">
              {editingId === p.id ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRate(p.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                    autoFocus
                    className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-[#534AB7]"
                    placeholder="0.00"
                  />
                  <span className="text-zinc-500 text-xs">/hr</span>
                  <button
                    onClick={() => saveRate(p.id)}
                    disabled={saving}
                    className="p-1.5 text-[#534AB7] hover:text-[#8B7FD4] transition-colors disabled:opacity-50"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="p-1.5 text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400">
                    {p.hourly_rate_usd ? (
                      <span className="text-zinc-300 font-medium">${p.hourly_rate_usd}/hr</span>
                    ) : (
                      <span className="text-zinc-600 italic">no rate set</span>
                    )}
                  </span>
                  <button
                    onClick={() => startEdit(p)}
                    className="p-1.5 text-zinc-700 hover:text-zinc-400 transition-colors"
                    title="Edit hourly rate"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
