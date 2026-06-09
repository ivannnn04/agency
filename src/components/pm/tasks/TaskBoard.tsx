"use client";

import { useState, useCallback, useEffect } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { createPMClient } from "@/lib/supabase/client";
import type { PMTask, PMTaskStatus } from "@/types/pm";
import PMTaskCard from "./TaskCard";
import PMTaskModal from "./TaskModal";
import { Plus } from "lucide-react";

const COLUMNS: { id: PMTaskStatus; label: string; color: string }[] = [
  { id: "todo", label: "To Do", color: "#6B7280" },
  { id: "in_progress", label: "In Progress", color: "#F59E0B" },
  { id: "review", label: "Review", color: "#8B5CF6" },
  { id: "done", label: "Done", color: "#10B981" },
];

interface Props {
  projectId: string;
  initialTasks: PMTask[];
  members: { id: string; full_name: string; avatar_url: string | null }[];
  currentUserId: string;
}

export default function PMTaskBoard({ projectId, initialTasks, members, currentUserId }: Props) {
  const [tasks, setTasks] = useState<PMTask[]>(initialTasks);
  const [selectedTask, setSelectedTask] = useState<PMTask | null>(null);
  const [creating, setCreating] = useState<PMTaskStatus | null>(null);
  const [activeLogMap, setActiveLogMap] = useState<Record<string, string>>({});
  const supabase = createPMClient();

  useEffect(() => {
    if (!currentUserId) return;
    supabase
      .from("pm_time_logs")
      .select("id, task_id")
      .eq("user_id", currentUserId)
      .is("ended_at", null)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, string> = {};
          data.forEach((l) => { map[l.task_id] = l.id; });
          setActiveLogMap(map);
        }
      });
  }, [currentUserId]);

  async function handleTimerToggle(taskId: string) {
    const activeLogId = activeLogMap[taskId];
    if (activeLogId) {
      const { data: log } = await supabase
        .from("pm_time_logs")
        .select("started_at")
        .eq("id", activeLogId)
        .single();
      const durationS = log?.started_at
        ? Math.round((Date.now() - new Date(log.started_at).getTime()) / 1000)
        : 0;
      await supabase
        .from("pm_time_logs")
        .update({ ended_at: new Date().toISOString(), duration_s: durationS })
        .eq("id", activeLogId);
      setActiveLogMap((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
    } else {
      const { data } = await supabase
        .from("pm_time_logs")
        .insert({ task_id: taskId, user_id: currentUserId, started_at: new Date().toISOString() })
        .select("id")
        .single();
      if (data) setActiveLogMap((prev) => ({ ...prev, [taskId]: data.id }));
    }
  }

  const tasksByColumn = (status: PMTaskStatus) => tasks.filter((t) => t.status === status);

  const onDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId as PMTaskStatus;
    setTasks((prev) => prev.map((t) => (t.id === draggableId ? { ...t, status: newStatus } : t)));
    await supabase.from("pm_tasks").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", draggableId);
  }, [supabase]);

  function handleTaskCreated(task: PMTask) { setTasks((prev) => [task, ...prev]); setCreating(null); }
  function handleTaskUpdated(u: PMTask) { setTasks((prev) => prev.map((t) => (t.id === u.id ? u : t))); setSelectedTask(null); }
  function handleTaskDeleted(id: string) { setTasks((prev) => prev.filter((t) => t.id !== id)); setSelectedTask(null); }

  return (
    <>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1 min-h-0">
          {COLUMNS.map((col) => (
            <div key={col.id} className="flex flex-col w-72 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                  <span className="text-sm font-medium text-zinc-300">{col.label}</span>
                  <span className="text-xs text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded-full">{tasksByColumn(col.id).length}</span>
                </div>
                <button onClick={() => setCreating(col.id)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                  <Plus size={16} />
                </button>
              </div>
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div ref={provided.innerRef} {...provided.droppableProps}
                    className={`flex-1 rounded-xl p-2 space-y-2 min-h-[100px] transition-colors ${snapshot.isDraggingOver ? "bg-zinc-800/50" : "bg-zinc-900/30"}`}>
                    {tasksByColumn(col.id).map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided, snapshot) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                            style={provided.draggableProps.style} className={snapshot.isDragging ? "opacity-75" : ""}>
                            <PMTaskCard
                              task={task}
                              onClick={() => setSelectedTask(task)}
                              isTimerRunning={!!activeLogMap[task.id]}
                              onTimerToggle={() => handleTimerToggle(task.id)}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      {creating && (
        <PMTaskModal projectId={projectId} initialStatus={creating} members={members}
          onCreated={handleTaskCreated} onClose={() => setCreating(null)} />
      )}
      {selectedTask && (
        <PMTaskModal projectId={projectId} task={selectedTask} members={members}
          onUpdated={handleTaskUpdated} onDeleted={handleTaskDeleted} onClose={() => setSelectedTask(null)} />
      )}
    </>
  );
}
