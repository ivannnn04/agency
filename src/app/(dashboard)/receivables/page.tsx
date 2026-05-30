'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { Plus, CheckCircle, AlertCircle, Clock, X, FolderOpen } from 'lucide-react'

interface Account { id: string; name: string; currency: string }
interface Project  { id: string; name: string; status: string }

interface ProjectReceivable {
  id: string
  name: string
  status: string
  contract_amount: number
  contract_currency: string
  received_before_app: number
  tx_received_usd: number
  contract_usd: number
  pre_usd: number
  remaining_usd: number
  remaining_native: number
}

interface Invoice {
  id: string
  client_name: string
  project_id: string | null
  amount: number
  paid_amount: number
  currency: string
  invoice_date: string
  due_date: string
  status: 'unpaid' | 'overdue' | 'paid'
  account_id: string | null
  notes: string | null
  paid_at: string | null
  projects?: { name: string } | null
}

const SYM: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

function daysOverdue(due: string) {
  return Math.floor((new Date().setHours(0,0,0,0) - new Date(due).setHours(0,0,0,0)) / 86400000)
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function ReceivablesPage() {
  const [projectRecs, setProjectRecs] = useState<ProjectReceivable[]>([])
  const [invoices, setInvoices]       = useState<Invoice[]>([])
  const [accounts, setAccounts]       = useState<Account[]>([])
  const [projects, setProjects]       = useState<Project[]>([])
  const [loading, setLoading]         = useState(true)
  const [addOpen, setAddOpen]         = useState(false)
  const [payProject, setPayProject]   = useState<ProjectReceivable | null>(null)
  const [payInvoice, setPayInvoice]   = useState<Invoice | null>(null)
  const { toUSD, fmtUSD }             = useRates()

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: projs }, { data: txs }, { data: invs }, { data: accs }] = await Promise.all([
      supabase.from('projects').select('id,name,status,contract_amount,contract_currency,received_before_app').not('contract_amount', 'is', null),
      supabase.from('transactions').select('type,amount,currency,project_id,is_planned').eq('type', 'income').eq('is_planned', false),
      supabase.from('invoices').select('*,projects(name)').order('due_date'),
      supabase.from('accounts').select('id,name,currency').order('created_at'),
    ])

    if (accs) setAccounts(accs)
    if (projs) setProjects(projs)

    // Build project receivables
    if (projs && txs) {
      const recs: ProjectReceivable[] = []
      for (const p of projs) {
        if (!p.contract_amount || p.contract_amount <= 0) continue
        const cur = p.contract_currency ?? 'USD'
        const contractUSD = toUSD(p.contract_amount, cur)
        const preUSD      = toUSD(p.received_before_app ?? 0, cur)
        const txUSD       = txs
          .filter(t => t.project_id === p.id)
          .reduce((s, t) => s + toUSD(t.amount, t.currency), 0)
        const remainingUSD    = contractUSD - preUSD - txUSD
        const remainingNative = remainingUSD / (toUSD(1, cur) || 1)
        if (remainingUSD > 0.01) {
          recs.push({
            id: p.id, name: p.name, status: p.status,
            contract_amount: p.contract_amount,
            contract_currency: cur,
            received_before_app: p.received_before_app ?? 0,
            tx_received_usd: txUSD,
            contract_usd: contractUSD,
            pre_usd: preUSD,
            remaining_usd: remainingUSD,
            remaining_native: remainingNative,
          })
        }
      }
      setProjectRecs(recs.sort((a, b) => b.remaining_usd - a.remaining_usd))
    }

    // Manual invoices: unpaid invoices that are NOT for a project with a contract
    // (to avoid double-counting)
    const projectsWithContract = new Set((projs ?? []).map(p => p.id))
    if (invs) {
      const manual = (invs as Invoice[]).filter(inv =>
        !inv.project_id || !projectsWithContract.has(inv.project_id)
      )
      setInvoices(manual)
    }

    setLoading(false)
  }

  const unpaidInvoices = invoices.filter(i => i.status !== 'paid')
  const paidInvoices   = invoices.filter(i => i.status === 'paid')
  const totalProjectRec = projectRecs.reduce((s, p) => s + p.remaining_usd, 0)
  const totalManualRec  = unpaidInvoices.reduce((s, i) => s + toUSD(i.amount - (i.paid_amount ?? 0), i.currency), 0)
  const grandTotal      = totalProjectRec + totalManualRec

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Дебіторка</h1>
          <p className="text-sm text-gray-500 mt-0.5">Кошти, які мають надійти</p>
        </div>
        <button onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={14} /> Ручний рахунок
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 text-white rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Загальна дебіторка</p>
          <p className="text-2xl font-bold">{fmtUSD(grandTotal)}</p>
          <p className="text-xs text-gray-500 mt-1">{projectRecs.length + unpaidInvoices.length} відкритих</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Від проектів</p>
          <p className="text-xl font-bold text-gray-900">{fmtUSD(totalProjectRec)}</p>
          <p className="text-xs text-gray-400 mt-1">{projectRecs.length} проектів</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Ручні рахунки</p>
          <p className="text-xl font-bold text-gray-900">{fmtUSD(totalManualRec)}</p>
          <p className="text-xs text-gray-400 mt-1">{unpaidInvoices.length} відкритих</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Завантаження...</div>
      ) : (
        <>
          {/* ── Project receivables ── */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen size={15} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Від проектів</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">автоматично</span>
            </div>

            {projectRecs.length === 0 ? (
              <div className="text-sm text-gray-400 bg-gray-50 rounded-xl p-6 text-center border border-dashed border-gray-200">
                Немає проектів з активною дебіторкою.<br />
                <span className="text-xs">Додайте суму контракту у розділі Проекти</span>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Проект</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Контракт</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Отримано</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Залишок</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">%</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {projectRecs.map(p => {
                      const sym = SYM[p.contract_currency]
                      const receivedNative = (p.pre_usd + p.tx_received_usd) / (toUSD(1, p.contract_currency) || 1)
                      const pct = Math.round((1 - p.remaining_usd / p.contract_usd) * 100)
                      return (
                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{p.name}</div>
                            {p.status === 'archived' && (
                              <span className="text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full">архів</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500">
                            {sym}{p.contract_amount.toLocaleString('en-US')}
                          </td>
                          <td className="px-4 py-3 text-right text-teal-600">
                            {sym}{receivedNative.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                            {p.received_before_app > 0 && (
                              <div className="text-[10px] text-blue-400">
                                вкл. {sym}{p.received_before_app.toLocaleString('en-US')} до старту
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="font-semibold text-gray-900">
                              {sym}{p.remaining_native.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                            </div>
                            {p.contract_currency !== 'USD' && (
                              <div className="text-[11px] text-gray-400">≈ {fmtUSD(p.remaining_usd)}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full bg-teal-400 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-gray-500">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => setPayProject(p)}
                              className="text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 px-3 py-1.5 rounded-lg font-medium transition-colors border border-teal-200">
                              Отримати
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Manual invoices ── */}
          {(unpaidInvoices.length > 0 || true) && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Ручні рахунки</h2>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">не привʼязані до проектів</span>
                </div>
              </div>

              {unpaidInvoices.length === 0 ? (
                <div className="text-sm text-gray-400 bg-gray-50 rounded-xl p-6 text-center border border-dashed border-gray-200">
                  Немає ручних рахунків. Натисніть "Ручний рахунок" щоб додати.
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Клієнт</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Сума</th>
                        <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Дедлайн</th>
                        <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Статус</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {unpaidInvoices.map(inv => {
                        const overdue = daysOverdue(inv.due_date)
                        const remaining = inv.amount - (inv.paid_amount ?? 0)
                        return (
                          <tr key={inv.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">{inv.client_name}</td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">
                              {SYM[inv.currency]}{remaining.toLocaleString('en-US')}
                            </td>
                            <td className="px-4 py-3 text-center text-gray-500">{fmtDate(inv.due_date)}</td>
                            <td className="px-4 py-3 text-center">
                              {overdue > 0
                                ? <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium"><AlertCircle size={11} />+{overdue}д</span>
                                : overdue === 0
                                  ? <span className="inline-flex items-center gap-1 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium"><Clock size={11} />Сьогодні</span>
                                  : <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium"><Clock size={11} />{Math.abs(overdue)}д</span>
                              }
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 justify-end">
                                <button onClick={() => setPayInvoice(inv)}
                                  className="text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 px-3 py-1.5 rounded-lg font-medium transition-colors border border-teal-200">
                                  Отримати
                                </button>
                                <button onClick={async () => { await supabase.from('invoices').delete().eq('id', inv.id); fetchAll() }}
                                  className="text-gray-300 hover:text-red-400 transition-colors"><X size={14} /></button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Paid */}
          {paidInvoices.length > 0 && <PaidSection paid={paidInvoices} fmtDate={fmtDate} />}
        </>
      )}

      {addOpen && (
        <AddInvoiceModal
          projects={projects.filter(p => p.status !== 'archived')}
          accounts={accounts}
          onClose={() => setAddOpen(false)}
          onSuccess={() => { setAddOpen(false); fetchAll() }}
        />
      )}

      {payProject && (
        <ReceiveProjectModal
          project={payProject}
          accounts={accounts}
          onClose={() => setPayProject(null)}
          onSuccess={() => { setPayProject(null); fetchAll() }}
        />
      )}

      {payInvoice && (
        <ReceiveInvoiceModal
          invoice={payInvoice}
          accounts={accounts}
          onClose={() => setPayInvoice(null)}
          onSuccess={() => { setPayInvoice(null); fetchAll() }}
        />
      )}
    </div>
  )
}

// ── Receive Project Payment Modal ──────────────────────────────────────────────

function ReceiveProjectModal({ project: p, accounts, onClose, onSuccess }: {
  project: ProjectReceivable
  accounts: Account[]
  onClose: () => void
  onSuccess: () => void
}) {
  const sym = SYM[p.contract_currency]
  const maxNative = p.remaining_native

  const [amount, setAmount]     = useState(maxNative.toFixed(2))
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Введіть суму'); return }
    if (amt > maxNative + 0.01) { setError(`Максимум: ${sym}${maxNative.toFixed(2)}`); return }
    if (!accountId) { setError('Оберіть рахунок'); return }
    setSaving(true)

    const { error: txErr } = await supabase.from('transactions').insert({
      type: 'income',
      amount: amt,
      currency: p.contract_currency,
      account_id: accountId,
      project_id: p.id,
      date: new Date().toISOString(),
      comment: `Оплата по проекту ${p.name}`,
      is_planned: false,
    })
    if (txErr) { setError(txErr.message); setSaving(false); return }

    await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: amt })
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Отримати оплату</h2>
            <p className="text-xs text-gray-400 mt-0.5">{p.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <div className="bg-gray-50 rounded-lg px-4 py-3 flex justify-between text-sm">
            <span className="text-gray-500">Залишок по контракту</span>
            <span className="font-semibold text-gray-900">{sym}{maxNative.toFixed(2)} {p.contract_currency}</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Сума до зарахування <span className="text-gray-400">(можна часткову)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{sym}</span>
              <input type="number" step="0.01" min="0.01"
                className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex gap-2 mt-1.5">
              <button type="button" onClick={() => setAmount(maxNative.toFixed(2))}
                className="text-[11px] text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100 px-2 py-0.5 rounded transition-colors">
                Повна сума
              </button>
              <button type="button" onClick={() => setAmount((maxNative / 2).toFixed(2))}
                className="text-[11px] text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded transition-colors">
                50%
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Зарахувати на рахунок</label>
            <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              value={accountId} onChange={e => setAccountId(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </div>
          {Number(amount) > 0 && Number(amount) < maxNative - 0.01 && (
            <div className="text-xs text-gray-500 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2">
              Часткова оплата — залишок <strong>{sym}{(maxNative - Number(amount)).toFixed(2)}</strong> залишиться відкритим
            </div>
          )}
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : 'Зарахувати'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Receive Invoice Payment Modal ──────────────────────────────────────────────

function ReceiveInvoiceModal({ invoice: inv, accounts, onClose, onSuccess }: {
  invoice: Invoice
  accounts: Account[]
  onClose: () => void
  onSuccess: () => void
}) {
  const paidSoFar  = inv.paid_amount ?? 0
  const remaining  = inv.amount - paidSoFar
  const sym        = SYM[inv.currency]

  const [amount, setAmount]     = useState(String(remaining))
  const [accountId, setAccountId] = useState(inv.account_id ?? accounts[0]?.id ?? '')
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Введіть суму'); return }
    if (amt > remaining + 0.01) { setError(`Максимум: ${sym}${remaining}`); return }
    setSaving(true)

    const newPaid = paidSoFar + amt
    const isFull  = newPaid >= inv.amount

    const { error: txErr } = await supabase.from('transactions').insert({
      type: 'income', amount: amt, currency: inv.currency, account_id: accountId,
      project_id: inv.project_id,
      date: new Date().toISOString(),
      comment: `Оплата від ${inv.client_name}${!isFull ? ` (часткова, залишок ${sym}${(inv.amount - newPaid).toFixed(2)})` : ''}`,
      is_planned: false,
    })
    if (txErr) { setError(txErr.message); setSaving(false); return }

    await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: amt })
    await supabase.from('invoices').update({
      paid_amount: newPaid,
      ...(isFull ? { status: 'paid', paid_at: new Date().toISOString() } : {}),
    }).eq('id', inv.id)
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Отримати оплату</h2>
            <p className="text-xs text-gray-400 mt-0.5">{inv.client_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <div className="bg-gray-50 rounded-lg px-4 py-3 flex justify-between text-sm">
            <span className="text-gray-500">Залишок по рахунку</span>
            <span className="font-semibold">{sym}{remaining.toLocaleString('en-US')} {inv.currency}</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Сума</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{sym}</span>
              <input type="number" step="0.01" min="0.01"
                className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Рахунок</label>
            <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              value={accountId} onChange={e => setAccountId(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : 'Зарахувати'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Paid section ───────────────────────────────────────────────────────────────

function PaidSection({ paid, fmtDate }: { paid: Invoice[]; fmtDate: (d: string) => string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-3 transition-colors">
        <CheckCircle size={14} className="text-teal-400" />
        {open ? 'Сховати' : 'Показати'} оплачені ручні рахунки ({paid.length})
      </button>
      {open && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Клієнт</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Сума</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase">Оплачено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paid.map(inv => (
                <tr key={inv.id} className="opacity-60">
                  <td className="px-4 py-3 text-gray-700">{inv.client_name}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{SYM[inv.currency]}{inv.amount.toLocaleString('en-US')}</td>
                  <td className="px-4 py-3 text-center text-gray-500">
                    {inv.paid_at ? fmtDate(inv.paid_at.split('T')[0]) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Add Manual Invoice Modal ───────────────────────────────────────────────────

function AddInvoiceModal({ projects, accounts, onClose, onSuccess }: {
  projects: Project[]
  accounts: Account[]
  onClose: () => void
  onSuccess: () => void
}) {
  const today = new Date().toISOString().split('T')[0]
  const in30  = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  const [clientName, setClientName]   = useState('')
  const [projectId, setProjectId]     = useState('')
  const [amount, setAmount]           = useState('')
  const [currency, setCurrency]       = useState('USD')
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate]         = useState(in30)
  const [accountId, setAccountId]     = useState(accounts[0]?.id ?? '')
  const [notes, setNotes]             = useState('')
  const [error, setError]             = useState('')
  const [saving, setSaving]           = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientName.trim()) { setError('Введіть імʼя клієнта'); return }
    if (!amount || Number(amount) <= 0) { setError('Введіть суму'); return }
    setSaving(true)
    const { error: err } = await supabase.from('invoices').insert({
      client_name: clientName.trim(), project_id: projectId || null,
      amount: Number(amount), paid_amount: 0, currency,
      invoice_date: invoiceDate, due_date: dueDate,
      account_id: accountId || null, notes: notes || null, status: 'unpaid',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Ручний рахунок</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Клієнт *</label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              placeholder="Назва або імʼя" value={clientName} onChange={e => setClientName(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Сума *</label>
              <input type="number" step="0.01" min="0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-gray-600 mb-1">Валюта</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                value={currency} onChange={e => setCurrency(e.target.value)}>
                <option>USD</option><option>EUR</option><option>UAH</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Дата виставлення</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Дедлайн оплати</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          {accounts.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Зарахувати на рахунок</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                value={accountId} onChange={e => setAccountId(e.target.value)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Примітка</label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              placeholder="Необовʼязково" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : 'Додати'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
