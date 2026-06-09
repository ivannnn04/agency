export type PMUserRole = "admin" | "member";
export type PMProjectStatus = "active" | "paused" | "done";
export type PMTaskStatus = "todo" | "in_progress" | "review" | "done";
export type PMTaskPriority = "low" | "medium" | "high";

export interface PMProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  role: PMUserRole;
  created_at: string;
}

export interface PMProject {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: PMProjectStatus;
  owner_id: string;
  created_at: string;
}

export interface PMProjectMember {
  project_id: string;
  user_id: string;
  profile?: PMProfile;
}

export interface PMTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: PMTaskStatus;
  priority: PMTaskPriority;
  assignee_id: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignee?: PMProfile;
}

export interface PMTimeLog {
  id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
}

export interface PMMessage {
  id: string;
  project_id: string;
  sender_id: string | null;
  content: string;
  is_ai: boolean;
  created_at: string;
  sender?: PMProfile;
}

export interface PMMeeting {
  id: string;
  project_id: string;
  title: string | null;
  meet_link: string | null;
  recording_url: string | null;
  transcript: string | null;
  summary: string | null;
  action_items: PMActionItem[] | null;
  created_at: string;
}

export interface PMActionItem {
  title: string;
  assignee_id: string;
  due_date: string;
}
