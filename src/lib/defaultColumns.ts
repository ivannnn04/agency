// Standard column set seeded into every new project board.
// Shared by the team dashboard (project creation) and the team board
// (rescue button for projects that ended up without columns).
export const DEFAULT_COLUMNS = [
  { name: 'TO DO',                 color: '#F59E0B', position: 0 },
  { name: 'IN PROGRESS',           color: '#6B7280', position: 1 },
  { name: 'INTERNAL REVIEW',       color: '#F97316', position: 2 },
  // Moving a task here emails the client that it is ready for their review
  { name: 'CLIENT REVIEW',         color: '#8B5CF6', position: 3 },
  { name: 'READY FOR DEVELOPMENT', color: '#10B981', position: 4 },
  { name: 'BLOCKED',               color: '#EC4899', position: 5 },
  { name: 'TO BE INVOICED',        color: '#6366F1', position: 6 },
]
