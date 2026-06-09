import { askAIPM, AI_PM_SYSTEM } from "@/lib/pm-claude";
import { createPMServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { transcript, projectId } = await req.json();

    const prompt = `Analyze this meeting transcript and provide:
1. SUMMARY: 3-4 bullet points of key decisions
2. ACTION ITEMS: extracted tasks as JSON array:
[{ "title": "...", "assignee": "...", "due_date": "YYYY-MM-DD" }]
3. CLIENT UPDATE: professional email draft (English)

Transcript:
${transcript}`;

    const result = await askAIPM(AI_PM_SYSTEM, prompt);

    if (projectId) {
      const supabase = await createPMServerClient();
      await supabase.from("pm_meetings").insert({
        project_id: projectId,
        transcript,
        summary: result,
      });
    }

    return NextResponse.json({ result });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to process transcript" }, { status: 500 });
  }
}
