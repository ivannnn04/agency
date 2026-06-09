import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function askAIPM(systemPrompt: string, userMessage: string) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  return response.content[0].type === "text" ? response.content[0].text : "";
}

export const AI_PM_SYSTEM = `You are an AI Project Manager assistant for Gudrix, a digital agency.
Team members: Ivan (lead), Denys (dev), Anna (design), Nadiia (content).
Monitor project progress proactively. Be concise and action-oriented.
When tasks are overdue — suggest pinging the responsible team member.
When a milestone is reached — offer to draft a client update email.
Always output action items as: { task, assignee, due_date, priority }`;
