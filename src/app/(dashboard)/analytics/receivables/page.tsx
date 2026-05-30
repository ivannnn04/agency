'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface ProjectRec {
  id: string
  name: string
  status: string
  contract_usd: number
  received_usd: number
  remaining_usd: number
  pct: number
}

interface InvoiceRec {
  id: string
  client_name: string
  remaining_usd: number
  due_date: string
}

export default function AnalyticsReceivablesPage() {
  const [projectRecs, setProjectRecs] = useState<ProjectRec[]>([])
  const [invoiceRecs, setInvoiceRecs] = useState<InvoiceRec[]>([])
  const [loading, setLoading]         = useState(true)
  const { toUSD, fmtUSD }             = useRates()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [{ data: projs }, { data: txs }, { data: invs }] = await Promise.all([
      supabase.from('projects').select('id,name,status,contract_amount,contract_currency,received_before_app').not('contract_amount', 'is', null),
      supabase.from('transactions').select('type,amount,currency,project_id,is_planned').eq('type', 'income').eq('is_planned', false),
      supabase.from('invoices').select('id,client_name,amount,paid_amount,currency,due_date,status,project_id').neq('status', 'paid'),
    ])

    if (projs && txs) {
      const projectsWithContract = new Set(projs.map(p => p.id))
      const recs: ProjectRec[] = []
      for (const p of projs) {
        if (!p.contract_amount || p.contract_amount <= 0) continue
        const cur         = p.contract_currency ?? 'USD'
        const contractUSD = toUSD(p.contract_amount, cur)
        const preUSD      = toUSD(p.received_before_app ?? 0, cur)
        const txUSD       = (txs ?? []).filter(t => t.project_id === p.id).reduce((s, t) => s + toUSD(t.amount, t.currency), 0)
        const receivedUSD = preUSD + txUSD
        const remainingUSD = contractUSD - receivedUSD
        if (remainingUSD > 0.01) {
          recs.push({
            id: p.id, name: p.name, status: p.status,
            contract_usd: contractUSD,
            received_usd: receivedUSD,
            remaining_usd: remainingUSD,
            pct: Math.round((receivedUSD / contractUSD) * 100),
          })
        }
      }
      setProjectRecs(recs.sort((a, b) => b.remaining_usd - a.remaining_usd))

      // Manual invoices not linked to projects with contracts
      if (invs) {
        const manual = invs.filter(inv => !inv.project_id || !projectsWithContract.has(inv.project_id))
        setInvoiceRecs(manual.map(inv => ({
          id: inv.id,
          client_name: inv.client_name,
          remaining_usd: toUSD(inv.amount - (inv.paid_amount ?? 0), inv.currency),
          due_date: inv.due_date,
        })))
      }
    }

    setLoading(false)
  }

  const totalProj    = projectRecs.reduce((s, p) => s + p.remaining_usd, 0)
  const totalInv     = invoiceRecs.reduce((s, i) => s + i.remaining_usd, 0)
  const grandTotal   = totalProj + totalInv

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/analytics" className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></Link>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Дебіторка</h1>
          <p className="text-sm text-gray-500">Кошти, які мають надійти</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-2xl font-bold text-gray-900">{fmtUSD(grandTotal)}</p>
          <p className="text-xs text-gray-400">загальна дебіторка</p>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-12">Завантаження...</p>
      ) : (
        <>
          {/* Project receivables */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Від проектів</h2>
              <span className="text-sm font-semibold text-gray-800">{fmtUSD(totalProj)}</span>
            </div>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left py-3 px-4 text-gray-500 font-medium">Проект</th>
                    <th className="text-right py-3 px-4 text-gray-500 font-medium">Контракт</th>
                    <th className="text-right py-3 px-4 text-gray-500 font-medium">Отримано</th>
                    <th className="text-right py-3 px-4 text-gray-500 font-medium">Залишок</th>
                    <th className="text-right py-3 px-4 text-gray-500 font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {projectRecs.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">
                      Немає дебіторки по проектах
                    </td></tr>
                  )}
                  {projectRecs.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-3 px-4 font-medium text-gray-800">
                        {p.name}
                        {p.status === 'archived' && (
                          <span className="ml-2 text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">архів</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-500">{fmtUSD(p.contract_usd)}</td>
                      <td className="py-3 px-4 text-right text-teal-600">{fmtUSD(p.received_usd)}</td>
                      <td className="py-3 px-4 text-right font-semibold text-gray-900">{fmtUSD(p.remaining_usd)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-400 rounded-full" style={{ width: `${p.pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{p.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Manual invoices */}
          {invoiceRecs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Ручні рахунки</h2>
                <span className="text-sm font-semibold text-gray-800">{fmtUSD(totalInv)}</span>
              </div>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left py-3 px-4 text-gray-500 font-medium">Клієнт</th>
                      <th className="text-right py-3 px-4 text-gray-500 font-medium">Дедлайн</th>
                      <th className="text-right py-3 px-4 text-gray-500 font-medium">Залишок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceRecs.map(inv => (
                      <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-3 px-4 text-gray-700">{inv.client_name}</td>
                        <td className="py-3 px-4 text-right text-gray-500">
                          {new Date(inv.due_date).toLocaleDateString('uk-UA')}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-gray-800">{fmtUSD(inv.remaining_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-6 text-center">
            Для дій (отримати оплату, додати рахунок) перейдіть у вкладку{' '}
            <Link href="/receivables" className="text-teal-500 hover:underline">Дебіторка</Link>
          </p>
        </>
      )}
    </div>
  )
}
