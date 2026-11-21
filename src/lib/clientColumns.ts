// What a client sees of the board. Money housekeeping is the agency's own
// business: a "To be invoiced" column reads as plain "Done" for the client
// (merged into an existing Done column when the board has one).

export const isInvoiceColumn = (name: string | null | undefined) => /invoic|інвойс/i.test(name ?? '')
const isDoneColumn = (name: string | null | undefined) => /^\s*(done|completed|готово|зроблено)\s*$/i.test(name ?? '')

export function clientBoard<
  C extends { id: string; name: string; color?: string | null },
  T extends { column_id: string | null },
>(columns: C[], tasks: T[]): { columns: C[]; tasks: T[] } {
  const invoice = columns.filter(c => isInvoiceColumn(c.name))
  if (invoice.length === 0) return { columns, tasks }

  const done = columns.find(c => isDoneColumn(c.name))
  // Everything that is finished for the client lands in one "Done" column
  const target = done ?? invoice[0]
  const gone = new Set(invoice.filter(c => c.id !== target.id).map(c => c.id))
  const moved = new Set(invoice.map(c => c.id))

  return {
    columns: columns
      .filter(c => !gone.has(c.id))
      .map(c => (c.id === target.id && !done ? { ...c, name: 'DONE', color: '#10B981' } : c)),
    tasks: tasks.map(t => (t.column_id && moved.has(t.column_id) ? { ...t, column_id: target.id } : t)),
  }
}
