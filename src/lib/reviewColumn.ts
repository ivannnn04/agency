// A board column where work waits for the client: "Client review" (the
// standard one), also "Review", "Waiting for feedback", "На погодженні"… —
// but never the team's own "Internal review".
// Shared by the boards (to know when to report a move) and the server
// (which re-checks before any email goes out).
export function isClientReviewColumn(name: string | null | undefined): boolean {
  const n = (name ?? '').toLowerCase()
  if (/internal|внутр/.test(n)) return false
  return /review|feedback|approval|рев.?ю|фідбек|погодж|перегляд/.test(n)
}
