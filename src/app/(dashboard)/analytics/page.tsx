'use client'

import { BarChart2 } from 'lucide-react'

export default function AnalyticsPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Аналітика</h1>
      <div className="text-center py-24 text-gray-400">
        <BarChart2 size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">Сторінка порожня — збираємо її заново</p>
      </div>
    </div>
  )
}
