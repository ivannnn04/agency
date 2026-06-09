import { askAIPM, AI_PM_SYSTEM } from "@/lib/pm-claude";
import { createPMServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { message, projectId } = await req.json();
    const supabase = await createPMServerClient();

    let context = "";
    if (projectId) {
      const { data: tasks } = await supabase
        .from("pm_tasks")
        .select("title, status, assignee_id, due_date")
        .eq("project_id", projectId)
        .order("due_date");

      context = `Current project tasks:\n${tasks
        ?.map((t) => `- ${t.title} [${t.status}] due: ${t.due_date ?? "no date"}`)
        .join("\n")}\n\n`;
    }

    const reply = await askAIPM(AI_PM_SYSTEM, context + "User message: " + message);
    return NextResponse.json({ reply });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ reply: "Sorry, I encountered an error. Please try again." }, { status: 500 });
  }
}
