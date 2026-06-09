"use client";

import { useState, useEffect } from "react";
import { createPMClient } from "@/lib/supabase/client";
import type { PMProfile } from "@/types/pm";
import { Check, Pencil, X, UserPlus, Clock, DollarSign } from "lucide-react";

interface ProfileWithEmail extends PMProfile { email?: string }

export default function PMTeamPage() {
  const [profiles, setProfiles] = useState<ProfileWithEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>("member");

  // Hourly rate editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRate, setInviteRate] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");

  // Payroll (this month)
  const [payroll, setPayroll] = useState<Record<string, number>>({});

  const supabase = createPMClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        if (me) setCurrentUserRole(me.role);
      }

      const { data } = await supabase
        .from("profiles").select("*").order("full_name");
      setProfiles((data as ProfileWithEmail[]) ?? []);
      setLoading(false);

      // Load this month's logged hours per user
      const start = new Date();
      start.setDate(1); start.setHours(0, 0, 0, 0);
      const { data: logs } = await supabase
        .from("pm_time_logs")
        .select("user_id, duration_s")
        .gte("started_at", start.toISOString())
        .not("duration_s", "is", null);
      if (logs) {
        const map: Record<string, number> = {};
        logs.forEach((l) => { map[l.user_id] = (map[l.user_id] ?? 0) + (l.duration_s ?? 0); });
        setPayroll(map);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdmin = currentUserRole === "admin";

  async function saveRate(profileId: string) {
    setSaving(true);
    const rate = rateInput ? Number(rateInput) : 0;
    await supabase.from("profiles").update({ hourly_rate_usd: rate }).eq("id", profileId);
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, hourly_rate_usd: rate } : p)));
    setSaving(false);
    setEditingId(null);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError("");
    const res = await fetch("/api/pm/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: inviteEmail,
        full_name: inviteName,
        password: invitePassword,
        hourly_rate_usd: inviteRate ? Number(inviteRate) : 0,
      }),
    });
    const json = await res.json();
    if (json.error) { setInviteError(json.error); setInviting(false); return; }

    // Add new profile to list
    setProfiles((prev) => [...prev, {
      id: json.user_id, full_name: inviteName, email: inviteEmail,
      role: "member", hourly_rate_usd: Number(inviteRate) || 0,
      avatar_url: null, created_at: new Date().toISOString(),
    }]);
    setInviteOpen(false);
    setInviteEmail(""); setInviteName(""); setInvitePassword(""); setInviteRate("");
    setInviting(false);
  }

  const thisMonthLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

  if (loading) return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-white mb-8">Team</h1>
      <p className="text-zinc-500 text-sm">Loading...</p>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Team</h1>
          <p className="text-zinc-500 text-sm mt-1">{profiles.length} members</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 bg-[#534AB7] hover:bg-[#4a42a8] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UserPlus size={15} /> Invite Member
          </button>
        )}
      </div>

      {/* Members list */}
      <div className="space-y-2">
        {profiles.map((p) => {
          const hoursThisMonth = ((payroll[p.id] ?? 0) / 3600);
          const earnedThisMonth = hoursThisMonth * (p.hourly_rate_usd ?? 0);

          return (
            <div key={p.id} className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#534AB7] flex items-center justify-center text-white font-medium shrink-0">
                {p.full_name.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-white font-medium">{p.full_name}</p>
                <p className="text-zinc-500 text-xs">{p.email ?? p.role}</p>
              </div>

              {/* This month hours */}
              {hoursThisMonth > 0 && (
                <div className="flex items-center gap-1 text-xs text-zinc-500 shrink-0">
                  <Clock size={12} />
                  <span>{hoursThisMonth.toFixed(1)}h</span>
                </div>
              )}

              {/* Earned this month */}
              {isAdmin && earnedThisMonth > 0 && (
                <div className="flex items-center gap-1 text-xs text-teal-400 shrink-0">
                  <DollarSign size={12} />
                  <span>${earnedThisMonth.toFixed(0)}</span>
                </div>
              )}

              {/* Hourly rate */}
              {isAdmin && (
                <div className="flex items-center gap-2 shrink-0">
                  {editingId === p.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-500 text-sm">$</span>
                      <input
                        type="number" step="0.01" min="0" autoFocus
                        value={rateInput} onChange={(e) => setRateInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRate(p.id); if (e.key === "Escape") setEditingId(null); }}
                        className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-[#534AB7]"
                        placeholder="0.00"
                      />
                      <span className="text-zinc-500 text-xs">/hr</span>
                      <button onClick={() => saveRate(p.id)} disabled={saving} className="p-1 text-[#534AB7] hover:text-[#8B7FD4] disabled:opacity-50">
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-zinc-600 hover:text-zinc-400">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">
                        {p.hourly_rate_usd ? (
                          <span className="text-zinc-300 font-medium">${p.hourly_rate_usd}/hr</span>
                        ) : (
                          <span className="text-zinc-600 italic text-xs">no rate</span>
                        )}
                      </span>
                      <button onClick={() => { setEditingId(p.id); setRateInput(p.hourly_rate_usd ? String(p.hourly_rate_usd) : ""); }}
                        className="p-1 text-zinc-700 hover:text-zinc-400 transition-colors">
                        <Pencil size={13} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Payroll summary (admin only) */}
      {isAdmin && Object.keys(payroll).length > 0 && (
        <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-zinc-400 mb-4">
            Payroll estimate · {thisMonthLabel}
          </h2>
          <div className="space-y-2">
            {profiles.filter((p) => payroll[p.id]).map((p) => {
              const hours = (payroll[p.id] ?? 0) / 3600;
              const earned = hours * (p.hourly_rate_usd ?? 0);
              return (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">{p.full_name}</span>
                  <div className="flex items-center gap-4 text-zinc-500">
                    <span>{hours.toFixed(1)}h</span>
                    {p.hourly_rate_usd ? (
                      <span className="text-teal-400 font-medium w-20 text-right">${earned.toFixed(0)}</span>
                    ) : (
                      <span className="text-zinc-700 w-20 text-right">no rate</span>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="border-t border-zinc-800 pt-3 flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">Total</span>
              <span className="text-sm font-semibold text-white">
                ${profiles.reduce((s, p) => {
                  const h = (payroll[p.id] ?? 0) / 3600;
                  return s + h * (p.hourly_rate_usd ?? 0);
                }, 0).toFixed(0)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {inviteOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-zinc-700 rounded-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800">
              <h2 className="text-white font-medium">Invite Team Member</h2>
              <button onClick={() => setInviteOpen(false)} className="text-zinc-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleInvite} className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Full Name *</label>
                <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} required autoFocus
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
                  placeholder="Jane Smith" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Email *</label>
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
                  placeholder="jane@company.com" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Password *</label>
                <input type="password" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} required
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
                  placeholder="min. 6 characters" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Hourly Rate (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                  <input type="number" step="0.01" min="0" value={inviteRate} onChange={(e) => setInviteRate(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-7 pr-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
                    placeholder="0.00" />
                </div>
              </div>
              {inviteError && <p className="text-red-400 text-xs">{inviteError}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setInviteOpen(false)}
                  className="flex-1 border border-zinc-700 text-zinc-400 hover:text-white py-2.5 rounded-lg text-sm transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={inviting}
                  className="flex-1 bg-[#534AB7] hover:bg-[#4a42a8] disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors">
                  {inviting ? "Creating..." : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
