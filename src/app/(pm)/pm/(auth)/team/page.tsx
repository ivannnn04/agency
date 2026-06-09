import { createPMServerClient } from "@/lib/supabase/server";

export default async function PMTeamPage() {
  const supabase = await createPMServerClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .order("full_name");

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Team</h1>
        <p className="text-zinc-500 text-sm mt-1">{profiles?.length ?? 0} members</p>
      </div>

      <div className="space-y-3">
        {profiles?.map((p) => (
          <div
            key={p.id}
            className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-4 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-full bg-[#534AB7] flex items-center justify-center text-white font-medium">
              {p.full_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-white font-medium">{p.full_name}</p>
              <p className="text-zinc-500 text-sm capitalize">{p.role}</p>
            </div>
            <div className="ml-auto">
              <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded-full capitalize">
                {p.role}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
