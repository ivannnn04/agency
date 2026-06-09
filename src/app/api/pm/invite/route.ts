import { NextRequest, NextResponse } from "next/server";
import supabaseAdmin from "@/lib/supabaseAdmin";
import { createPMServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  // Verify caller is a PM admin
  const pmClient = await createPMServerClient();
  const { data: { user } } = await pmClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: callerProfile } = await pmClient
    .from("profiles").select("role").eq("id", user.id).single();
  if (callerProfile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, full_name, password, hourly_rate_usd } = await req.json();
  if (!email || !full_name || !password) {
    return NextResponse.json({ error: "email, full_name and password are required" }, { status: 400 });
  }

  // Create Supabase Auth user (skip email confirmation)
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });

  // Upsert profile
  const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
    id: authData.user.id,
    full_name,
    email,
    role: "member",
    hourly_rate_usd: hourly_rate_usd ? Number(hourly_rate_usd) : 0,
    avatar_url: null,
  });
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 });

  return NextResponse.json({ success: true, user_id: authData.user.id });
}
