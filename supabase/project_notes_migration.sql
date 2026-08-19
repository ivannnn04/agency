-- Admin notes per project (what the payments were for, agreements, etc.)
alter table projects add column if not exists notes text;
