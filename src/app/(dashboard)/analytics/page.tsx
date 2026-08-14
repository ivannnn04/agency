'use client'

import { BarChart2 } from 'lucide-react'

// Intentionally blank — the old dashboard (KPI cards, project receivables
// table, report links) was removed to rebuild this page from scratch.
export default function AnalyticsPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Аналітика</h1>
      <div className="text-center py-24 text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">
        <BarChart2 size={36} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">Сторінка очищена</p>
        <p className="text-xs mt-1 text-gray-300">Опиши, які показники тут потрібні — і зберемо заново</p>
      </div>
    </div>
  )
}
