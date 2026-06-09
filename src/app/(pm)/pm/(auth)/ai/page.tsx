"use client";

import { useState } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";

interface AIMessage {
  role: "user" | "ai";
  content: string;
}

export default function PMAIPage() {
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      role: "ai",
      content:
        "Hello! I'm your AI Project Manager for Gudrix. I can help you review project status, identify blockers, generate client updates, and more. What would you like to discuss?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    const res = await fetch("/api/pm/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMsg }),
    });
    const { reply } = await res.json();

    setMessages((prev) => [...prev, { role: "ai", content: reply }]);
    setLoading(false);
  }

  const quickPrompts = [
    "What tasks are overdue?",
    "Generate a client update email",
    "What should the team focus on today?",
    "Flag any project risks",
  ];

  return (
    <div className="max-w-3xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#534AB7] flex items-center justify-center">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">AI Project Manager</h1>
            <p className="text-zinc-500 text-xs">Powered by Claude</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            {msg.role === "ai" && (
              <div className="w-7 h-7 rounded-full bg-[#534AB7] flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles size={13} className="text-white" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                msg.role === "ai"
                  ? "bg-[#1a1a1a] border border-zinc-800 text-zinc-200"
                  : "bg-[#534AB7] text-white"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-[#534AB7] flex items-center justify-center shrink-0">
              <Sparkles size={13} className="text-white" />
            </div>
            <div className="bg-[#1a1a1a] border border-zinc-800 rounded-xl px-4 py-3">
              <Loader2 size={16} className="text-zinc-500 animate-spin" />
            </div>
          </div>
        )}
      </div>

      {messages.length === 1 && (
        <div className="flex flex-wrap gap-2 mb-3 shrink-0">
          {quickPrompts.map((p) => (
            <button
              key={p}
              onClick={() => setInput(p)}
              className="text-xs text-zinc-400 border border-zinc-700 hover:border-zinc-500 hover:text-white px-3 py-1.5 rounded-full transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSend} className="flex gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask AI PM anything..."
          className="flex-1 bg-[#1a1a1a] border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#534AB7] transition-colors"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="p-3 bg-[#534AB7] hover:bg-[#4a42a8] disabled:opacity-50 text-white rounded-xl transition-colors"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
