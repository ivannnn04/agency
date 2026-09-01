// Standard column set seeded into every new project board.
// Shared by the team dashboard (project creation) and the team board
// (rescue button for projects that ended up without columns).
export const DEFAULT_COLUMNS = [
  { name: 'TO DO',                 color: '#F59E0B', position: 0 },
  { name: 'IN PROGRESS',           color: '#6B7280', position: 1 },
  { name: 'INTERNAL REVIEW',       color: '#F97316', position: 2 },
  { name: 'READY FOR REPORT',      color: '#8B5CF6', position: 3 },
  { name: 'WAITING FOR FEEDBACK',  color: '#EF4444', position: 4 },
  { name: 'READY FOR DEVELOPMENT', color: '#10B981', position: 5 },
  { name: 'BLOCKED',               color: '#EC4899', position: 6 },
  { name: 'TO BE INVOICED',        color: '#6366F1', position: 7 },
]
