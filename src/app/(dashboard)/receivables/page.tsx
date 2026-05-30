'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import { Plus, CheckCircle, AlertCircle, Clock, X } from 'lucide-react'

interface Project { id: string; name: string }
interface Account { id: string; name: string; currency: string }

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
  accounts?: { name: string } | null
}

function daysOverdue(due: string): number {
  const diff = new Date().setHours(0,0,0,0) - new Date(due).setHours(0,0,0,0)
  return Math.floor(diff / 86400000)
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

export default function ReceivablesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null)
  const { toUSD, fmtUSD } = useRates()

  const unpaid = invoices.filter(i => i.status !== 'paid')
  const paid   = invoices.filter(i => i.status === 'paid')
  const totalOwed = unpaid.reduce((s, i) => s + toUSD(i.amount - (i.paid_amount ?? 0), i.currency), 0)
  const overdueCnt = unpaid.filter(i => daysOverdue(i.due_date) > 0).length

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: inv }, { data: proj }, { data: acc }] = await Promise.all([
      supabase.from('invoices').select('*, projects(name), accounts(name)').order('due_date'),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('accounts').select('id, name, currency').order('created_at'),
    ])
    if (inv) setInvoices(inv as Invoice[])
    if (proj) setProjects(proj)
    if (acc) setAccounts(acc)
    setLoading(false)
  }

  async function deleteInvoice(id: string) {
    await supabase.from('invoices').delete().eq('id', id)
    fetchAll()
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Дебіторка</h1>
          <p className="text-sm text-gray-500 mt-0.5">Рахунки до отримання</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> Додати рахунок
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Всього до отримання</p>
          <p className="text-2xl font-bold text-gray-900">{fmtUSD(totalOwed)}</p>
          <p className="text-xs text-gray-400 mt-1">{unpaid.length} відкритих рахунків</p>
        </div>
        <div className={`rounded-xl p-4 border ${overdueCnt > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
          <p className="text-xs text-gray-500 mb-1">Прострочено</p>
          <p className={`text-2xl font-bold ${overdueCnt > 0 ? 'text-red-600' : 'text-gray-900'}`}>{overdueCnt}</p>
          <p className="text-xs text-gray-400 mt-1">рахунків прострочено</p>
        </div>
        <div className="bg-teal-50 rounded-xl p-4 border border-teal-100">
          <p className="text-xs text-gray-500 mb-1">Отримано (всього)</p>
          <p className="text-2xl font-bold text-teal-600">
            {fmtUSD(paid.reduce((s, i) => s + toUSD(i.amount, i.currency), 0))}
          </p>
          <p className="text-xs text-gray-400 mt-1">{paid.length} закритих рахунків</p>
        </div>
      </div>

      {/* Unpaid invoices table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Завантаження...</div>
      ) : unpaid.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle size={40} className="mx-auto mb-3 text-teal-300" />
          <p className="font-medium text-gray-500">Всі рахунки оплачені!</p>
          <p className="text-sm mt-1">Немає відкритих заборгованостей</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Клієнт</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Проект</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Сума / Залишок</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Виставлено</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Дедлайн</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Статус</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {unpaid.map(inv => {
                const overdue = daysOverdue(inv.due_date)
                const paidAmt = inv.paid_amount ?? 0
                const remaining = inv.amount - paidAmt
                const isPartial = paidAmt > 0
                const sym = CURRENCY_SYMBOL[inv.currency]
                return (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{inv.client_name}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.projects?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {isPartial ? (
                        <>
                          <div className="font-semibold text-gray-900">{sym}{remaining.toLocaleString('en-US')}</div>
                          <div className="text-[11px] text-gray-400">з {sym}{inv.amount.toLocaleString('en-US')}</div>
                          {/* progress bar */}
                          <div className="mt-1 h-1 w-20 ml-auto bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-400 rounded-full" style={{ width: `${(paidAmt / inv.amount) * 100}%` }} />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-semibold text-gray-900">{sym}{inv.amount.toLocaleString('en-US')}</div>
                          {inv.currency !== 'USD' && (
                            <div className="text-[11px] text-gray-400">≈ {fmtUSD(toUSD(inv.amount, inv.currency))}</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">{fmtDate(inv.invoice_date)}</td>
                    <td className="px-4 py-3 text-center text-gray-500">{fmtDate(inv.due_date)}</td>
                    <td className="px-4 py-3 text-center">
                      {overdue > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                          <AlertCircle size={11} /> +{overdue}д
                        </span>
                      ) : overdue === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                          <Clock size={11} /> Сьогодні
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                          <Clock size={11} /> {Math.abs(overdue)}д
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => setPayInvoice(inv)}
                          className="text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 px-3 py-1.5 rounded-lg font-medium transition-colors border border-teal-200"
                        >
                          Отримано
                        </button>
                        <button
                          onClick={() => deleteInvoice(inv.id)}
                          className="text-gray-300 hover:text-red-400 transition-colors"
                          title="Видалити"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paid invoices */}
      {paid.length > 0 && (
        <PaidSection paid={paid} fmtDate={fmtDate} fmtUSD={fmtUSD} toUSD={toUSD} />
      )}

      {addOpen && (
        <AddInvoiceModal
          projects={projects}
          accounts={accounts}
          onClose={() => setAddOpen(false)}
          onSuccess={() => { setAddOpen(false); fetchAll() }}
        />
      )}

      {payInvoice && (
        <ReceivePaymentModal
          invoice={payInvoice}
          accounts={accounts}
          onClose={() => setPayInvoice(null)}
          onSuccess={() => { setPayInvoice(null); fetchAll() }}
        />
      )}
    </div>
  )
}

// ── Receive Payment Modal ──────────────────────────────────────────────────────

function ReceivePaymentModal({ invoice, accounts, onClose, onSuccess }: {
  invoice: Invoice
  accounts: Account[]
  onClose: () => void
  onSuccess: () => void
}) {
  const paidSoFar = invoice.paid_amount ?? 0
  const remaining = invoice.amount - paidSoFar
  const sym = CURRENCY_SYMBOL[invoice.currency]

  const [amount, setAmount]     = useState(String(remaining))
  const [accountId, setAccountId] = useState(invoice.account_id ?? accounts[0]?.id ?? '')
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Введіть суму'); return }
    if (amt > remaining) { setError(`Максимум: ${sym}${remaining.toLocaleString('en-US')}`); return }
    if (!accountId) { setError('Оберіть рахунок'); return }
    setSaving(true)

    const newPaid = paidSoFar + amt
    const isFull  = newPaid >= invoice.amount

    // Create income transaction
    const { error: txErr } = await supabase.from('transactions').insert({
      type: 'income',
      amount: amt,
      currency: invoice.currency,
      account_id: accountId,
      project_id: invoice.project_id,
      date: new Date().toISOString(),
      comment: `Оплата від ${invoice.client_name}${invoice.notes ? ' — ' + invoice.notes : ''}${!isFull ? ` (часткова, залишок ${sym}${(invoice.amount - newPaid).toLocaleString('en-US')})` : ''}`,
      is_planned: false,
    })
    if (txErr) { setError(txErr.message); setSaving(false); return }

    // Update account balance
    await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: amt })

    // Update invoice
    await supabase.from('invoices').update({
      paid_amount: newPaid,
      ...(isFull ? { status: 'paid', paid_at: new Date().toISOString() } : {}),
    }).eq('id', invoice.id)

    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Отримати оплату</h2>
            <p className="text-xs text-gray-400 mt-0.5">{invoice.client_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          {/* Debt summary */}
          <div className="bg-gray-50 rounded-lg px-4 py-3 flex justify-between text-sm">
            <span className="text-gray-500">До отримання</span>
            <span className="font-semibold text-gray-900">{sym}{remaining.toLocaleString('en-US')} {invoice.currency}</span>
          </div>
          {paidSoFar > 0 && (
            <div className="bg-teal-50 rounded-lg px-4 py-2 flex justify-between text-xs">
              <span className="text-gray-500">Вже отримано</span>
              <span className="text-teal-600 font-medium">{sym}{paidSoFar.toLocaleString('en-US')}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Сума до зарахування <span className="text-gray-400">(можна часткову)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{sym}</span>
              <input
                type="number" step="0.01" min="0.01" max={remaining}
                className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2 mt-1.5">
              <button type="button" onClick={() => setAmount(String(remaining))}
                className="text-[11px] text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100 px-2 py-0.5 rounded transition-colors">
                Повна сума
              </button>
              <button type="button" onClick={() => setAmount(String(Math.round(remaining / 2 * 100) / 100))}
                className="text-[11px] text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded transition-colors">
                50%
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Зарахувати на рахунок</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              value={accountId} onChange={e => setAccountId(e.target.value)}
            >
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </div>

          {/* Preview */}
          {Number(amount) > 0 && Number(amount) < remaining && (
            <div className="text-xs text-gray-500 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2">
              Часткова оплата — залишок <strong>{sym}{(remaining - Number(amount)).toLocaleString('en-US')}</strong> залишиться відкритим
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

// ── Paid invoices section ──────────────────────────────────────────────────────

function PaidSection({ paid, fmtDate, fmtUSD, toUSD }: {
  paid: Invoice[]
  fmtDate: (d: string) => string
  fmtUSD: (n: number) => string
  toUSD: (amount: number, currency: string) => number
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-3 transition-colors">
        <CheckCircle size={14} className="text-teal-400" />
        {open ? 'Сховати' : 'Показати'} оплачені ({paid.length})
      </button>
      {open && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Клієнт</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Проект</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Сума</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Оплачено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paid.map(inv => (
                <tr key={inv.id} className="opacity-60">
                  <td className="px-4 py-3 text-gray-700">{inv.client_name}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.projects?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {CURRENCY_SYMBOL[inv.currency]}{inv.amount.toLocaleString('en-US')}
                  </td>
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

// ── Add Invoice Modal ──────────────────────────────────────────────────────────

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
      client_name:  clientName.trim(),
      project_id:   projectId || null,
      amount:       Number(amount),
      paid_amount:  0,
      currency,
      invoice_date: invoiceDate,
      due_date:     dueDate,
      account_id:   accountId || null,
      notes:        notes || null,
      status:       'unpaid',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Новий рахунок до отримання</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Клієнт *</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              placeholder="Назва компанії або імʼя"
              value={clientName} onChange={e => setClientName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Проект</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
              value={projectId} onChange={e => setProjectId(e.target.value)}
            >
              <option value="">— без проекту —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Сума *</label>
              <input
                type="number" step="0.01" min="0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                placeholder="0.00"
                value={amount} onChange={e => setAmount(e.target.value)}
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-gray-600 mb-1">Валюта</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                value={currency} onChange={e => setCurrency(e.target.value)}
              >
                <option>USD</option>
                <option>EUR</option>
                <option>UAH</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Дата виставлення</label>
              <input type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Дедлайн оплати</label>
              <input type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          {accounts.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Зарахувати на рахунок</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                value={accountId} onChange={e => setAccountId(e.target.value)}
              >
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Примітка</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              placeholder="Необовʼязково"
              value={notes} onChange={e => setNotes(e.target.value)}
            />
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : 'Додати рахунок'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
