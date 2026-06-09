import { createPMServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import PMChatPanel from "@/components/pm/chat/ChatPanel";

export default async function PMChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createPMServerClient();

  const [{ data: project }, { data: messages }, { data: { user } }] = await Promise.all([
    supabase.from("pm_projects").select("name, color").eq("id", id).single(),
    supabase
      .from("pm_messages")
      .select("*, sender:profiles(id, full_name, avatar_url)")
      .eq("project_id", id)
      .order("created_at", { ascending: true })
      .limit(50),
    supabase.auth.getUser(),
  ]);

  if (!project) notFound();

  return (
    <div className="h-full flex flex-col max-w-3xl mx-auto w-full">
      <div className="mb-4 shrink-0">
        <h1 className="text-xl font-semibold text-white">{project.name}</h1>
        <p className="text-zinc-500 text-sm">Project Chat</p>
      </div>
      <PMChatPanel
        projectId={id}
        initialMessages={messages ?? []}
        currentUserId={user?.id ?? ""}
      />
    </div>
  );
}
