"use client";

import { useState, useEffect, useRef } from "react";
import { createPMClient } from "@/lib/supabase/client";
import type { PMTask, PMTaskStatus, PMTaskPriority, PMTaskComment, PMTaskAttachment } from "@/types/pm";
import { X, Trash2, Play, Square, Paperclip, Send, FileText, Clock } from "lucide-react";
import { format } from "date-fns";

const STATUS_LABELS: Record<PMTaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  internal_review: "Internal Review",
  blocked: "Blocked",
  ready_for_report: "Ready for Report",
  to_be_invoiced: "To be Invoiced",
  completed: "Completed",
};

const STATUS_COLORS: Record<PMTaskStatus, string> = {
  todo: "#6B7280",
  in_progress: "#F59E0B",
  internal_review: "#8B5CF6",
  blocked: "#EF4444",
  ready_for_report: "#06B6D4",
  to_be_invoiced: "#10B981",
  completed: "#3B82F6",
};

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Props {
  projectId: string;
  task?: PMTask;
  initialStatus?: PMTaskStatus;
  members: { id: string; full_name: string; avatar_url: string | null }[];
  currentUserId?: string;
  isTimerRunning?: boolean;
  onTimerToggle?: () => void;
  onCreated?: (task: PMTask) => void;
  onUpdated?: (task: PMTask) => void;
  onDeleted?: (id: string) => void;
  onClose: () => void;
}

export default function PMTaskModal({
  projectId,
  task,
  initialStatus = "todo",
  members,
  currentUserId: currentUserIdProp,
  isTimerRunning = false,
  onTimerToggle,
  onCreated,
  onUpdated,
  onDeleted,
  onClose,
}: Props) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<PMTaskStatus>(task?.status ?? initialStatus);
  const [priority, setPriority] = useState<PMTaskPriority>(task?.priority ?? "medium");
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(!task);

  // Timer
  const [elapsed, setElapsed] = useState(0);
  const [totalLoggedSeconds, setTotalLoggedSeconds] = useState(0);
  const [activeLogStart, setActiveLogStart] = useState<Date | null>(null);

  // Comments
  const [comments, setComments] = useState<PMTaskComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const [currentUserId, setCurrentUserId] = useState(currentUserIdProp ?? "");

  // Attachments
  const [attachments, setAttachments] = useState<PMTaskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createPMClient();

  useEffect(() => {
    if (currentUserIdProp) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (!task) return;

    if (isTimerRunning) {
      supabase
        .from("pm_time_logs")
        .select("id, started_at")
        .eq("task_id", task.id)
        .is("ended_at", null)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.started_at) setActiveLogStart(new Date(data.started_at));
        });
    } else {
      setActiveLogStart(null);
    }

    supabase
      .from("pm_time_logs")
      .select("duration_s")
      .eq("task_id", task.id)
      .not("duration_s", "is", null)
      .then(({ data }) => {
        const total = (data ?? []).reduce((s, l) => s + (l.duration_s ?? 0), 0);
        setTotalLoggedSeconds(total);
      });

    supabase
      .from("pm_task_comments")
      .select("*, author:profiles(id, full_name, avatar_url)")
      .eq("task_id", task.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => setComments((data as PMTaskComment[]) ?? []));

    supabase
      .from("pm_task_attachments")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => setAttachments((data as PMTaskAttachment[]) ?? []));

    const ch = supabase
      .channel(`task-comments-${task.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pm_task_comments", filter: `task_id=eq.${task.id}` },
        async (payload) => {
          const { data } = await supabase
            .from("pm_task_comments")
            .select("*, author:profiles(id, full_name, avatar_url)")
            .eq("id", payload.new.id)
            .single();
          if (data) setComments((prev) => [...prev, data as PMTaskComment]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, isTimerRunning]);

  useEffect(() => {
    if (!activeLogStart) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.round((Date.now() - activeLogStart.getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeLogStart]);

  useEffect(() => {
    if (!isTimerRunning) setActiveLogStart(null);
  }, [isTimerRunning]);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description || null,
      status,
      priority,
      assignee_id: assigneeId || null,
      due_date: dueDate || null,
      updated_at: new Date().toISOString(),
    };
    if (task) {
      const { data } = await supabase
        .from("pm_tasks")
        .update(payload)
        .eq("id", task.id)
        .select("*, assignee:profiles(id, full_name, avatar_url)")
        .single();
      if (data) { onUpdated?.(data as PMTask); setDirty(false); }
    } else {
      const { data } = await supabase
        .from("pm_tasks")
        .insert({ ...payload, project_id: projectId, created_by: currentUserId })
        .select("*, assignee:profiles(id, full_name, avatar_url)")
        .single();
      if (data) onCreated?.(data as PMTask);
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!task || !confirm("Delete this task?")) return;
    await supabase.from("pm_tasks").delete().eq("id", task.id);
    onDeleted?.(task.id);
  }

  async function handleSendComment() {
    if (!commentText.trim() || !task) return;
    setSendingComment(true);
    await supabase.from("pm_task_comments").insert({
      task_id: task.id,
      user_id: currentUserId,
      content: commentText.trim(),
    });
    setCommentText("");
    setSendingComment(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !task) return;
    setUploading(true);
    const path = `${task.id}/${Date.now()}-${file.name}`;
    const { data: storageData, error } = await supabase.storage
      .from("pm-attachments")
      .upload(path, file);
    if (!error && storageData) {
      const { data: urlData } = supabase.storage
        .from("pm-attachments")
        .getPublicUrl(storageData.path);
      const { data: attData } = await supabase
        .from("pm_task_attachments")
        .insert({
          task_id: task.id,
          user_id: currentUserId,
          file_name: file.name,
          file_url: urlData.publicUrl,
          file_size: file.size,
          mime_type: file.type,
        })
        .select()
        .single();
      if (attData) setAttachments((prev) => [...prev, attData as PMTaskAttachment]);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDeleteAttachment(att: PMTaskAttachment) {
    await supabase.from("pm_task_attachments").delete().eq("id", att.id);
    try {
      const url = new URL(att.file_url);
      const parts = url.pathname.split("/pm-attachments/");
      if (parts[1]) await supabase.storage.from("pm-attachments").remove([decodeURIComponent(parts[1])]);
    } catch {
      // ignore URL parse errors
    }
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
  }

  const totalHoursDisplay = ((totalLoggedSeconds + (isTimerRunning ? elapsed : 0)) / 3600).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => { if (!dirty) onClose(); }} />

      <div className="w-[680px] bg-[#161616] border-l border-zinc-800 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>PM</span>
            <span>/</span>
            <span className="text-zinc-400">{task ? "Edit Task" : "New Task"}</span>
          </div>
          <div className="flex items-center gap-1">
            {task && (
              <button
                onClick={handleDelete}
                className="p-2 text-zinc-600 hover:text-red-400 rounded-lg transition-colors"
                title="Delete task"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-zinc-600 hover:text-white rounded-lg transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">
            {/* Title */}
            <input
              value={title}
              onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
              placeholder="Task title"
              autoFocus={!task}
              className="w-full bg-transparent text-white text-xl font-semibold placeholder-zinc-600 focus:outline-none border-b border-transparent focus:border-zinc-700 pb-1 transition-colors"
            />

            {/* Properties */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Status</label>
                <div className="relative">
                  <span
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none"
                    style={{ backgroundColor: STATUS_COLORS[status] }}
                  />
                  <select
                    value={status}
                    onChange={(e) => markDirty(setStatus)(e.target.value as PMTaskStatus)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7] appearance-none cursor-pointer"
                  >
                    {(Object.keys(STATUS_LABELS) as PMTaskStatus[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => markDirty(setPriority)(e.target.value as PMTaskPriority)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7] cursor-pointer"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Assignee</label>
                <select
                  value={assigneeId}
                  onChange={(e) => markDirty(setAssigneeId)(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7] cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => markDirty(setDueDate)(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
                />
              </div>
            </div>

            {/* Timer — existing tasks only */}
            {task && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={onTimerToggle}
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                        isTimerRunning ? "bg-[#534AB7] hover:bg-red-500" : "bg-zinc-800 hover:bg-[#534AB7]"
                      }`}
                    >
                      {isTimerRunning
                        ? <Square size={13} className="text-white" />
                        : <Play size={13} className="text-white ml-0.5" />}
                    </button>
                    <div>
                      {isTimerRunning ? (
                        <p className="text-[#8B7FD4] text-sm font-mono font-medium tracking-wider">
                          {formatDuration(elapsed)}
                        </p>
                      ) : (
                        <p className="text-zinc-500 text-sm">Timer stopped</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-500 text-sm">
                    <Clock size={13} />
                    <span>{totalHoursDisplay}h logged</span>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
                rows={4}
                placeholder="Add a description..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#534AB7] resize-none transition-colors"
              />
            </div>

            {/* Attachments — existing tasks only */}
            {task && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-500">Attachments ({attachments.length})</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1.5 text-xs text-[#8B7FD4] hover:text-[#534AB7] transition-colors disabled:opacity-50"
                  >
                    <Paperclip size={12} />
                    {uploading ? "Uploading..." : "Add file"}
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                </div>
                {attachments.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="group relative bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden"
                      >
                        {att.mime_type?.startsWith("image/") ? (
                          <img src={att.file_url} alt={att.file_name} className="w-full h-20 object-cover" />
                        ) : (
                          <div className="w-full h-20 flex flex-col items-center justify-center gap-1 px-2">
                            <FileText size={20} className="text-zinc-600" />
                            <span className="text-[10px] text-zinc-500 text-center truncate w-full">{att.file_name}</span>
                          </div>
                        )}
                        <button
                          onClick={() => handleDeleteAttachment(att)}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Comments — existing tasks only */}
          {task && (
            <div className="border-t border-zinc-800 px-6 py-5">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-4">
                Activity · {comments.length} comment{comments.length !== 1 ? "s" : ""}
              </h3>

              <div className="space-y-4 mb-4 max-h-64 overflow-y-auto pr-1">
                {comments.length === 0 && (
                  <p className="text-zinc-600 text-sm">No comments yet.</p>
                )}
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#534AB7] flex items-center justify-center text-white text-xs font-medium shrink-0 mt-0.5">
                      {(c.author?.full_name ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-xs font-medium text-zinc-300">{c.author?.full_name ?? "Unknown"}</span>
                        <span className="text-[10px] text-zinc-600">
                          {format(new Date(c.created_at), "MMM d, HH:mm")}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">{c.content}</p>
                    </div>
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </div>

              <div className="flex gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendComment(); }
                  }}
                  placeholder="Write a comment..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7] transition-colors"
                />
                <button
                  onClick={handleSendComment}
                  disabled={sendingComment || !commentText.trim()}
                  className="w-9 h-9 bg-[#534AB7] hover:bg-[#4a42a8] disabled:opacity-40 rounded-lg flex items-center justify-center transition-colors shrink-0"
                >
                  <Send size={14} className="text-white" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 border border-zinc-700 text-zinc-400 hover:text-white py-2.5 rounded-lg text-sm transition-colors"
          >
            {dirty && task ? "Discard" : "Close"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="flex-1 bg-[#534AB7] hover:bg-[#4a42a8] disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? "Saving..." : task ? "Save Changes" : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
}
