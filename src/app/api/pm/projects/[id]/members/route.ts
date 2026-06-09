import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";
import { createPMServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const pmClient = await createPMServerClient();
  const { data: { user } } = await pmClient.auth.getUser();
  if (!user) return null;
  const { data: profile } = await pmClient.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return null;
  return user;
}

// POST → add member to project
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: project_id } = await params;
  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("pm_project_members")
    .upsert({ project_id, user_id }, { onConflict: "project_id,user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

// DELETE → remove member from project
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: project_id } = await params;
  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("pm_project_members")
    .delete()
    .eq("project_id", project_id)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
