import type { PMTask } from "@/types/pm";
import { Calendar, AlertCircle, Play, Square } from "lucide-react";
import { format, isPast, parseISO } from "date-fns";

interface Props {
  task: PMTask;
  onClick: () => void;
  isTimerRunning: boolean;
  onTimerToggle: () => void;
}

const PRIORITY_COLORS = { low: "text-zinc-500", medium: "text-amber-400", high: "text-red-400" };
const PRIORITY_BG = { low: "bg-zinc-800", medium: "bg-amber-500/10", high: "bg-red-500/10" };

export default function PMTaskCard({ task, onClick, isTimerRunning, onTimerToggle }: Props) {
  const isOverdue = task.due_date && isPast(parseISO(task.due_date)) && task.status !== "done";

  return (
    <div className={`bg-[#1e1e1e] border rounded-lg p-3 cursor-pointer transition-colors group ${
      isTimerRunning ? "border-[#534AB7]/60" : "border-zinc-800 hover:border-zinc-600"
    }`}>
      {isTimerRunning && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#534AB7] animate-pulse" />
          <span className="text-[10px] text-[#8B7FD4]">Timer running</span>
        </div>
      )}

      <p onClick={onClick} className="text-sm text-zinc-200 group-hover:text-white transition-colors mb-2 leading-relaxed">
        {task.title}
      </p>

      <div className="flex items-center justify-between">
        <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${PRIORITY_BG[task.priority]} ${PRIORITY_COLORS[task.priority]}`}>
          {task.priority}
        </span>

        <div className="flex items-center gap-2">
          {task.due_date && (
            <span className={`flex items-center gap-1 text-xs ${isOverdue ? "text-red-400" : "text-zinc-600"}`}>
              {isOverdue ? <AlertCircle size={11} /> : <Calendar size={11} />}
              {format(parseISO(task.due_date), "MMM d")}
            </span>
          )}
          {task.assignee && (
            <div className="w-5 h-5 rounded-full bg-[#534AB7] flex items-center justify-center text-white text-[9px] font-medium">
              {(task.assignee as { full_name: string }).full_name.charAt(0)}
            </div>
          )}
          {/* Timer button */}
          <button
            onClick={(e) => { e.stopPropagation(); onTimerToggle(); }}
            title={isTimerRunning ? "Stop timer" : "Start timer"}
            className={`p-1 rounded transition-colors ${
              isTimerRunning
                ? "text-[#534AB7] hover:text-red-400"
                : "text-zinc-700 hover:text-[#534AB7] opacity-0 group-hover:opacity-100"
            }`}
          >
            {isTimerRunning ? <Square size={11} /> : <Play size={11} />}
          </button>
        </div>
      </div>
    </div>
  );
}
