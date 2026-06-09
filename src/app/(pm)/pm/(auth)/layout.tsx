import { createPMServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PMSidebar from "@/components/pm/layout/Sidebar";
import PMTopbar from "@/components/pm/layout/Topbar";

export default async function PMDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createPMServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/pm/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: projects } = await supabase
    .from("pm_projects")
    .select("id, name, color, status")
    .order("created_at", { ascending: false });

  return (
    <div className="flex h-screen bg-[#0f0f0f] overflow-hidden">
      <PMSidebar projects={projects ?? []} profile={profile} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <PMTopbar profile={profile} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
