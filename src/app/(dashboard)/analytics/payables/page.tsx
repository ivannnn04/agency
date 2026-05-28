'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import SettleModal from '@/components/modals/SettleModal'

interface DebtItem {
  counterparty_id: string
  counterparty_name: string
  total: number
}

export default function PayablesPage() {
  const [items, setItems] = useState<DebtItem[]>([])
  const [settleItem, setSettleItem] = useState<DebtItem | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const { data } = await supabase
      .from('transactions')
      .select('amount, counterparty:counterparties(id, name)')
      .eq('type', 'expense')
      .eq('is_planned', false)

    if (!data) return

    const map: Record<string, { name: string; total: number }> = {}
    data.forEach((t: any) => {
      if (!t.counterparty) return
      const id = t.counterparty.id
      if (!map[id]) map[id] = { name: t.counterparty.name, total: 0 }
      map[id].total += t.amount
    })

    setItems(
      Object.entries(map)
        .map(([id, v]) => ({ counterparty_id: id, counterparty_name: v.name, total: v.total }))
        .sort((a, b) => b.total - a.total)
    )
  }

  const total = items.reduce((s, i) => s + i.total, 0)

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">
          Кредиторка <span className="text-red-500">₴ {total.toLocaleString('uk-UA')}</span>
        </h1>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Контрагент</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Кредиторка</th>
              <th className="py-3 px-4 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.counterparty_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-3 px-4 text-gray-700">{item.counterparty_name}</td>
                <td className="py-3 px-4 text-right font-medium text-gray-800">
                  ₴ {item.total.toLocaleString('uk-UA')}
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => setSettleItem(item)}
                    className="bg-orange-50 text-orange-600 hover:bg-orange-100 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                  >
                    Погасити
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center py-12 text-gray-400">Немає кредиторської заборгованості</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {settleItem && (
        <SettleModal
          open={!!settleItem}
          title={`Погашення кредиторки для «${settleItem.counterparty_name}»`}
          totalAmount={settleItem.total}
          type="expense"
          onClose={() => setSettleItem(null)}
          onSuccess={() => { setSettleItem(null); fetchData() }}
        />
      )}
    </div>
  )
}
