'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { adjustBalancesForTransaction } from '@/lib/transactionBalances'
import { Account } from '@/types'
import { ReceiptText, X, Paperclip, Loader2, Send, Trash2, FileText } from 'lucide-react'
import { fileTooBig, safeStoragePath, MAX_FILE_MB, useChatWidth, ChatResizeHandle } from '@/components/chat/shared'

// Project invoices drawer.
// Admin mode (no portalToken): create invoices with an attached file, toggle
// to_be_paid ↔ paid, delete. Client mode (portalToken): read-only list.
// The team never sees this — the component is only mounted on the admin board
// and in the client portal.

interface InvoiceRow {
  id: string
  title: string
  amount: number | null
  currency: string
  file_url: string | null
  file_name: string | null
  status: 'to_be_paid' | 'paid'
  created_at: string
  paid_at: string | null
  income_tx_id: string | null
  fee_tx_id: string | null
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', UAH: '₴' }

function fmtAmount(inv: InvoiceRow) {
  if (inv.amount == null) return null
  const sym = CURRENCY_SYMBOL[inv.currency] ?? inv.currency + ' '
  return sym + Number(inv.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export default function ProjectInvoices({ projectId, portalToken, onClose }: {
  projectId: string
  portalToken?: string
  onClose: () => void
}) {
  const isAdmin = !portalToken
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [payingInvoice, setPayingInvoice] = useState<InvoiceRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { width, startResize } = useChatWidth()

  // Admin needs the account list for the mark-as-paid popup
  useEffect(() => {
    if (!isAdmin) return
    supabase.from('accounts').select('*').order('created_at').then(({ data }) => {
      if (data) setAccounts(data as Account[])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  const load = useCallback(async () => {
    if (portalToken) {
      const res = await fetch(`/api/portal/project/${projectId}/invoices`, {
        headers: { Authorization: `Bearer ${portalToken}` },
      })
      if (res.ok) {
        const { invoices: rows } = await res.json()
        setInvoices(rows)
      }
      return
    }
    const { data, error: err } = await supabase
      .from('project_invoices')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (err) { setError('Таблиця project_invoices не знайдена — запусти project_invoices_migration.sql'); return }
    setInvoices((data ?? []) as InvoiceRow[])
  }, [projectId, portalToken])

  useEffect(() => {
    load()
    const iv = setInterval(load, 15000)
    return () => clearInterval(iv)
  }, [load])

  async function addInvoice() {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    setError('')

    let fileUrl: string | null = null
    let fileName: string | null = null
    if (pendingFile) {
      const path = safeStoragePath(projectId, `invoice-${pendingFile.name}`)
      const { error: upErr } = await supabase.storage.from('chat-files').upload(path, pendingFile)
      if (upErr) { setBusy(false); setError('Не вдалося завантажити файл'); return }
      const { data: pub } = supabase.storage.from('chat-files').getPublicUrl(path)
      fileUrl = pub.publicUrl
      fileName = pendingFile.name
    }

    const { error: insErr } = await supabase.from('project_invoices').insert({
      project_id: projectId,
      title: t,
      amount: amount.trim() === '' ? null : Number(amount) || null,
      currency,
      file_url: fileUrl,
      file_name: fileName,
      status: 'to_be_paid',
    })
    setBusy(false)
    if (insErr) { setError('Не вдалося зберегти інвойс'); return }
    setTitle(''); setAmount(''); setPendingFile(null)
    load()
  }

  // Marking paid goes through the popup (account + fee) and books transactions;
  // un-marking deletes those transactions and reverses the balance changes.
  async function toggleStatus(inv: InvoiceRow) {
    if (inv.status !== 'paid') {
      setPayingInvoice(inv)
      return
    }
    if (!window.confirm('Скасувати оплату? Створені транзакції буде видалено, баланс рахунку — відкориговано.')) return
    for (const txId of [inv.income_tx_id, inv.fee_tx_id]) {
      if (!txId) continue
      const { data: tx } = await supabase
        .from('transactions')
        .select('type, amount, account_id, to_account_id, to_amount')
        .eq('id', txId)
        .single()
      if (tx) {
        await adjustBalancesForTransaction(tx, -1)
        await supabase.from('transactions').delete().eq('id', txId)
      }
    }
    await supabase
      .from('project_invoices')
      .update({ status: 'to_be_paid', paid_at: null, income_tx_id: null, fee_tx_id: null })
      .eq('id', inv.id)
    load()
  }

  // Popup confirm: income for the full invoice amount + optional fee expense,
  // both tied to the project so per-project analytics stay true.
  async function confirmPaid(inv: InvoiceRow, accountId: string, amountPaid: number, fee: number) {
    const today = new Date().toISOString().slice(0, 10)

    const { data: incomeTx, error: incErr } = await supabase
      .from('transactions')
      .insert({
        type: 'income',
        amount: amountPaid,
        currency: inv.currency,
        account_id: accountId,
        project_id: projectId,
        date: today,
        comment: `Оплата інвойсу «${inv.title}»`,
        is_planned: false,
      })
      .select('id, type, amount, account_id')
      .single()
    if (incErr || !incomeTx) throw new Error(incErr?.message ?? 'Не вдалося створити транзакцію')
    await adjustBalancesForTransaction({ type: 'income', amount: amountPaid, account_id: accountId }, 1)

    let feeTxId: string | null = null
    if (fee > 0) {
      // Fees land in a dedicated expense category so they're easy to total up
      let { data: feeCat } = await supabase
        .from('categories')
        .select('id')
        .eq('type', 'expense')
        .ilike('name', '%коміс%')
        .limit(1)
        .maybeSingle()
      if (!feeCat) {
        const { data: created } = await supabase
          .from('categories')
          .insert({ name: 'Комісії', type: 'expense' })
          .select('id')
          .single()
        feeCat = created
      }
      const { data: feeTx } = await supabase
        .from('transactions')
        .insert({
          type: 'expense',
          amount: fee,
          currency: inv.currency,
          account_id: accountId,
          category_id: feeCat?.id ?? null,
          project_id: projectId,
          date: today,
          comment: `Комісія за інвойс «${inv.title}»`,
          is_planned: false,
        })
        .select('id')
        .single()
      if (feeTx) {
        feeTxId = feeTx.id
        await adjustBalancesForTransaction({ type: 'expense', amount: fee, account_id: accountId }, 1)
      }
    }

    await supabase
      .from('project_invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        amount: amountPaid,
        income_tx_id: incomeTx.id,
        fee_tx_id: feeTxId,
      })
      .eq('id', inv.id)
    setPayingInvoice(null)
    load()
  }

  async function deleteInvoice(id: string) {
    setInvoices(prev => prev.filter(i => i.id !== id))
    await supabase.from('project_invoices').delete().eq('id', id)
  }

  const locale = isAdmin ? 'uk-UA' : 'en-US'

  return (
    <div
      className="fixed right-0 top-0 h-full bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
      style={{ width }}
    >
      <ChatResizeHandle onMouseDown={startResize} />

      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ReceiptText size={15} className="text-indigo-500" />
          <p className="text-sm font-semibold text-gray-800">{isAdmin ? 'Інвойси' : 'Invoices'}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded"><X size={16} /></button>
      </div>

      {/* Admin composer */}
      {isAdmin && (
        <div className="border-b border-gray-100 p-3 flex flex-col gap-2 flex-shrink-0">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Назва — напр. Invoice #12, етап 2"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <div className="flex items-center gap-2">
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              type="number" min={0} step="0.01"
              placeholder="Сума"
              className="flex-1 min-w-0 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option>USD</option><option>EUR</option><option>UAH</option>
            </select>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) {
                setError('')
                if (fileTooBig(f)) { setError(`Файл завеликий — максимум ${MAX_FILE_MB} МБ`); return }
                setPendingFile(f)
              }
              e.target.value = ''
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-50 transition-colors"
              title="Прикріпити файл інвойсу (PDF)"
            >
              <Paperclip size={15} />
            </button>
            {pendingFile && (
              <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 rounded-lg px-2 py-1 min-w-0">
                <span className="truncate max-w-[140px]">{pendingFile.name}</span>
                <button onClick={() => setPendingFile(null)} className="text-gray-300 hover:text-red-400">
                  <X size={11} />
                </button>
              </span>
            )}
            <button
              onClick={addInvoice}
              disabled={busy || !title.trim()}
              className="ml-auto flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-xl px-3.5 py-2 text-xs font-medium transition-colors"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Надіслати клієнту
            </button>
          </div>
          {error && <p className="text-[11px] text-red-500">{error}</p>}
        </div>
      )}

      {/* Invoice list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {invoices.length === 0 && (
          <p className="text-xs text-gray-300 text-center mt-8 flex flex-col items-center gap-2">
            <ReceiptText size={22} className="opacity-40" />
            {isAdmin ? 'Ще немає інвойсів' : 'No invoices yet'}
          </p>
        )}
        {invoices.map(inv => {
          const amountStr = fmtAmount(inv)
          const paid = inv.status === 'paid'
          return (
            <div key={inv.id} className="group bg-white border border-gray-100 rounded-xl px-3.5 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{inv.title}</p>
                  <p className="text-[10px] text-gray-400">
                    {new Date(inv.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                    {paid && inv.paid_at && (
                      <> · {isAdmin ? 'оплачено' : 'paid'} {new Date(inv.paid_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</>
                    )}
                  </p>
                </div>
                {amountStr && <p className="text-sm font-bold text-gray-900 flex-shrink-0">{amountStr}</p>}
              </div>

              <div className="flex items-center gap-2 mt-2">
                {isAdmin ? (
                  <button
                    onClick={() => toggleStatus(inv)}
                    title="Клікни, щоб змінити статус"
                    className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md transition-colors ${
                      paid
                        ? 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                  >
                    {paid ? '✓ Оплачено' : 'Очікує оплати'}
                  </button>
                ) : (
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md ${
                    paid ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {paid ? '✓ Paid' : 'To be paid'}
                  </span>
                )}

                {inv.file_url && (
                  <a
                    href={inv.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-md font-medium transition-colors min-w-0"
                  >
                    <FileText size={11} className="flex-shrink-0" />
                    <span className="truncate max-w-[140px]">{inv.file_name ?? 'invoice'}</span>
                  </a>
                )}

                {isAdmin && (
                  <button
                    onClick={() => deleteInvoice(inv.id)}
                    className="ml-auto opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-1"
                    title="Видалити інвойс"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Mark-as-paid popup: which account received the money + payment fee */}
      {payingInvoice && (
        <MarkPaidModal
          invoice={payingInvoice}
          accounts={accounts}
          onClose={() => setPayingInvoice(null)}
          onConfirm={confirmPaid}
        />
      )}
    </div>
  )
}

// ── Mark-as-paid popup ─────────────────────────────────────────────────────────

function MarkPaidModal({ invoice, accounts, onClose, onConfirm }: {
  invoice: InvoiceRow
  accounts: Account[]
  onClose: () => void
  onConfirm: (inv: InvoiceRow, accountId: string, amountPaid: number, fee: number) => Promise<void>
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [amount, setAmount] = useState(invoice.amount != null ? String(invoice.amount) : '')
  const [fee, setFee] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const sym = CURRENCY_SYMBOL[invoice.currency] ?? invoice.currency

  async function submit() {
    const amt = Number(amount)
    const feeNum = fee.trim() === '' ? 0 : Number(fee)
    if (!accountId) { setErr('Оберіть рахунок'); return }
    if (!amt || amt <= 0) { setErr('Вкажіть суму, яка надійшла'); return }
    if (feeNum < 0 || isNaN(feeNum)) { setErr('Комісія некоректна'); return }
    setBusy(true)
    setErr('')
    try {
      await onConfirm(invoice, accountId, amt, feeNum)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Щось пішло не так')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Оплата інвойсу</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[240px]">{invoice.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">На який рахунок надійшли кошти *</label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Сума інвойсу ({sym}) *</label>
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              type="number" min={0} step="0.01"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Комісія за транзакцію ({sym})</label>
            <input
              value={fee}
              onChange={e => setFee(e.target.value)}
              type="number" min={0} step="0.01"
              placeholder="0 — якщо без комісії"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Дохід буде проведено на повну суму інвойсу, комісія — окремою витратою в категорії «Комісії»
            </p>
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Скасувати
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {busy ? 'Проводимо...' : 'Провести оплату'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
