"use client";

import { useState } from "react";
import { createPMClient } from "@/lib/supabase/client";
import type { PMTask, PMTaskStatus, PMTaskPriority } from "@/types/pm";
import { X, Trash2 } from "lucide-react";

interface Props {
  projectId: string;
  task?: PMTask;
  initialStatus?: PMTaskStatus;
  members: { id: string; full_name: string; avatar_url: string | null }[];
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
  const [loading, setLoading] = useState(false);
  const supabase = createPMClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const payload = {
      title,
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
      if (data) onUpdated?.(data as PMTask);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("pm_tasks")
        .insert({ ...payload, project_id: projectId, created_by: user?.id })
        .select("*, assignee:profiles(id, full_name, avatar_url)")
        .single();
      if (data) onCreated?.(data as PMTask);
    }
    setLoading(false);
  }

  async function handleDelete() {
    if (!task) return;
    if (!confirm("Delete this task?")) return;
    await supabase.from("pm_tasks").delete().eq("id", task.id);
    onDeleted?.(task.id);
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-zinc-700 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <h2 className="text-white font-medium">{task ? "Edit Task" : "New Task"}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Task title"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#534AB7] transition-colors"
            />
          </div>

          <div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Description (optional)"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7] transition-colors resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as PMTaskStatus)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PMTaskPriority)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Assignee</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#534AB7]"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            {task && (
              <button
                type="button"
                onClick={handleDelete}
                className="p-2.5 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-zinc-700 text-zinc-400 hover:text-white py-2.5 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title}
              className="flex-1 bg-[#534AB7] hover:bg-[#4a42a8] disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? "Saving..." : task ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
