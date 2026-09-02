'use client'

import WorkloadView from '@/components/WorkloadView'

// Admin workload page: a column per team member with their queued tasks
// and estimates — shows when a new task would actually get started.
export default function WorkloadPage() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Завантаженість</h1>
        <p className="text-xs text-gray-400 mt-1">
          Черга активних задач кожного учасника. «Старт через» рахується з естімейтів мінус уже затреканий час.
        </p>
      </div>
      <WorkloadView canEdit />
    </div>
  )
}
