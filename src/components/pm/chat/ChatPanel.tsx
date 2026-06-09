"use client";

import { useState, useRef, useEffect } from "react";
import { createPMClient } from "@/lib/supabase/client";
import type { PMMessage } from "@/types/pm";
import { Send, Sparkles } from "lucide-react";
import { format } from "date-fns";

interface Props {
  projectId: string;
  initialMessages: PMMessage[];
  currentUserId: string;
}

export default function PMChatPanel({ projectId, initialMessages, currentUserId }: Props) {
  const [messages, setMessages] = useState<PMMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createPMClient();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const channel = supabase
      .channel(`pm-chat-${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `project_id=eq.${projectId}` },
        async (payload) => {
          const { data } = await supabase
            .from("messages")
            .select("*, sender:profiles(id, full_name, avatar_url)")
            .eq("id", payload.new.id)
            .single();
          if (data) setMessages((prev) => [...prev, data as PMMessage]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [projectId, supabase]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    const content = text.trim();
    setText("");

    await supabase.from("messages").insert({
      project_id: projectId,
      sender_id: currentUserId,
      content,
      is_ai: false,
    });

    setSending(false);
  }

  async function askAI() {
    if (aiLoading) return;
    setAiLoading(true);
    const lastMessages = messages
      .slice(-5)
      .map((m) => `${(m.sender as { full_name: string } | null)?.full_name ?? "AI"}: ${m.content}`)
      .join("\n");

    const res = await fetch("/api/pm/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: lastMessages || "Give me a project status update.", projectId }),
    });
    const { reply } = await res.json();

    await supabase.from("messages").insert({
      project_id: projectId,
      sender_id: null,
      content: reply,
      is_ai: true,
    });
    setAiLoading(false);
  }

  return (
    <div className="flex flex-col flex-1 bg-[#1a1a1a] border border-zinc-800 rounded-xl overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-zinc-600 text-sm py-8">
            No messages yet. Start the conversation!
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === currentUserId;
          const sender = msg.sender as { full_name: string } | null;

          if (msg.is_ai) {
            return (
              <div key={msg.id} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-[#534AB7] flex items-center justify-center shrink-0">
                  <Sparkles size={13} className="text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-[#8B7FD4]">AI PM</span>
                    <span className="text-xs text-zinc-700">
                      {format(new Date(msg.created_at), "HH:mm")}
                    </span>
                  </div>
                  <div className="bg-[#534AB7]/10 border border-[#534AB7]/20 rounded-xl px-4 py-3 text-sm text-zinc-200 whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""}`}>
              <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-white text-xs font-medium shrink-0">
                {sender?.full_name.charAt(0) ?? "?"}
              </div>
              <div className={`max-w-[70%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                {!isMe && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-zinc-400">{sender?.full_name}</span>
                    <span className="text-xs text-zinc-700">
                      {format(new Date(msg.created_at), "HH:mm")}
                    </span>
                  </div>
                )}
                <div
                  className={`rounded-xl px-4 py-2.5 text-sm ${
                    isMe ? "bg-[#534AB7] text-white" : "bg-zinc-800 text-zinc-200"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 p-3">
        <form onSubmit={sendMessage} className="flex gap-2">
          <button
            type="button"
            onClick={askAI}
            disabled={aiLoading}
            title="Ask AI PM"
            className="p-2.5 text-zinc-500 hover:text-[#8B7FD4] transition-colors disabled:opacity-50"
          >
            <Sparkles size={18} />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7] transition-colors"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="p-2.5 bg-[#534AB7] hover:bg-[#4a42a8] disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
