'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Account, Category, Project, Counterparty, Currency, TransactionType, Transaction, TeamMember } from '@/types'
import { cn } from '@/lib/utils'
import { adjustBalancesForTransaction } from '@/lib/transactionBalances'

interface Props {
  open: boolean
  defaultType?: TransactionType
  transaction?: Transaction | null
  onClose: () => void
  onSuccess: () => void
}

export default function AddTransactionModal({ open, defaultType = 'income', transaction, onClose, onSuccess }: Props) {
  const isEdit = !!transaction
  const [type, setType] = useState<TransactionType>(defaultType)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [counterparties, setCounterparties] = useState<Counterparty[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  // Salary month to close as paid (YYYY-MM) when paying a team member
  const [salaryMonth, setSalaryMonth] = useState('')

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('EUR')
  const [toAmount, setToAmount] = useState('')
  const [toCurrency, setToCurrency] = useState<Currency>('EUR')
  const [accountId, setAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [counterpartyId, setCounterpartyId] = useState('')
  const [newCounterparty, setNewCounterparty] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [comment, setComment] = useState('')
  const [isPlanned, setIsPlanned] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (open) {
      fetchData()
      if (transaction) {
        setType(transaction.type)
        setAmount(String(transaction.amount))
        setCurrency(transaction.currency)
        setToAmount(transaction.to_amount != null ? String(transaction.to_amount) : '')
        setToCurrency(transaction.to_currency ?? transaction.currency)
        setAccountId(transaction.account_id)
        setToAccountId(transaction.to_account_id ?? '')
        setCategoryId(transaction.category_id ?? '')
        setProjectId(transaction.project_id ?? '')
        setCounterpartyId(transaction.counterparty_id ?? '')
        setNewCounterparty('')
        setDate(transaction.date.split('T')[0])
        setComment(transaction.comment ?? '')
        setIsPlanned(transaction.is_planned)
      } else {
        setType(defaultType)
        resetForm()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultType, transaction])

  async function fetchData() {
    const [acc, cat, proj, cpart, mems] = await Promise.all([
      supabase.from('accounts').select('*').order('created_at'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('projects').select('*').eq('status', 'active').order('name'),
      supabase.from('counterparties').select('*').order('name'),
      supabase.from('team_members').select('*').order('name'),
    ])
    if (acc.data) setAccounts(acc.data)
    if (cat.data) setCategories(cat.data)
    if (proj.data) setProjects(proj.data)
    if (cpart.data) setCounterparties(cpart.data)
    if (mems.data) setTeamMembers(mems.data)
    if (!isEdit && acc.data?.[0]) setAccountId(acc.data[0].id)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !accountId) return
    setSubmitError('')
    setLoading(true)

    try {
      let finalCounterpartyId: string | null = counterpartyId || null
      let salaryMemberId: string | null = null

      // Team member picked as counterparty: find-or-create a counterparties
      // row with their name so the transaction links up normally
      if (counterpartyId.startsWith('team:')) {
        salaryMemberId = counterpartyId.slice(5)
        const member = teamMembers.find(m => m.id === salaryMemberId)
        const memberName = member?.name ?? 'Team member'
        const existing = counterparties.find(c => c.name.toLowerCase() === memberName.toLowerCase())
        if (existing) {
          finalCounterpartyId = existing.id
        } else {
          const { data } = await supabase
            .from('counterparties')
            .insert({ name: memberName })
            .select()
            .single()
          finalCounterpartyId = data?.id ?? null
        }
      }

      if (newCounterparty.trim()) {
        const { data } = await supabase
          .from('counterparties')
          .insert({ name: newCounterparty.trim() })
          .select()
          .single()
        if (data) finalCounterpartyId = data.id
      }

      const txAmount = parseFloat(amount)
      const toTxAmount = type === 'transfer' ? parseFloat(toAmount || amount) : txAmount
      const payload: Record<string, unknown> = {
        type,
        amount: txAmount,
        currency,
        account_id: accountId,
        category_id: categoryId || null,
        project_id: projectId || null,
        counterparty_id: finalCounterpartyId,
        date: new Date(date).toISOString(),
        comment: comment || null,
        is_planned: isPlanned,
      }

      if (type === 'transfer') {
        payload.to_account_id = toAccountId || null
        payload.to_amount = toTxAmount
        payload.to_currency = toCurrency
      } else {
        payload.to_account_id = null
        payload.to_amount = null
      }

      if (isEdit && transaction) {
        // The DB write must succeed BEFORE balances move — otherwise a failed
        // write silently corrupts account balances
        const { error: updErr } = await supabase.from('transactions').update(payload).eq('id', transaction.id)
        if (updErr) { setSubmitError(`Не збережено: ${updErr.message}`); return }
        await adjustBalancesForTransaction(transaction, -1)
        await adjustBalancesForTransaction({
          type, amount: txAmount, account_id: accountId,
          to_account_id: type === 'transfer' ? toAccountId || null : null,
          to_amount: type === 'transfer' ? toTxAmount : null,
        }, 1)
      } else {
        const { error: insErr } = await supabase.from('transactions').insert(payload)
        if (insErr) { setSubmitError(`Не збережено: ${insErr.message}`); return }
        await adjustBalancesForTransaction({
          type, amount: txAmount, account_id: accountId,
          to_account_id: type === 'transfer' ? toAccountId || null : null,
          to_amount: type === 'transfer' ? toTxAmount : null,
        }, 1)
      }

      // Salary paid to a team member for a specific month: mark all tracked
      // hours of that month as paid — visible to the admin payroll page and
      // in the member's own report
      if (!isEdit && type === 'expense' && salaryMemberId && salaryMonth) {
        const periodKey = `${salaryMonth}-01`
        const monthStart = new Date(`${salaryMonth}-01T00:00:00`)
        const monthEnd = new Date(monthStart)
        monthEnd.setMonth(monthEnd.getMonth() + 1)
        const { data: ents } = await supabase
          .from('time_entries')
          .select('duration_seconds')
          .eq('team_member_id', salaryMemberId)
          .not('ended_at', 'is', null)
          .gte('started_at', monthStart.toISOString())
          .lt('started_at', monthEnd.toISOString())
        const totalSeconds = (ents ?? []).reduce((s, e) => s + (e.duration_seconds ?? 0), 0)
        const member = teamMembers.find(m => m.id === salaryMemberId)
        const amountUsd = member?.salary_type === 'monthly'
          ? (member.monthly_salary_usd ?? 0)
          : Math.round((totalSeconds / 3600) * (member?.hourly_rate_usd ?? 0) * 100) / 100
        await supabase.from('salary_payments').upsert({
          team_member_id: salaryMemberId,
          period_month: periodKey,
          total_seconds: totalSeconds,
          amount_usd: amountUsd,
          status: 'paid',
          confirmed_at: new Date().toISOString(),
          paid_at: new Date().toISOString(),
          account_id: accountId,
        }, { onConflict: 'team_member_id,period_month' })
      }

      onSuccess()
      onClose()
      resetForm()
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setAmount('')
    setCurrency('EUR')
    setToAmount('')
    setToCurrency('EUR')
    setCategoryId('')
    setProjectId('')
    setCounterpartyId('')
    setNewCounterparty('')
    setDate(new Date().toISOString().split('T')[0])
    setComment('')
    setIsPlanned(false)
    setSalaryMonth('')
  }

  if (!open) return null

  const filteredCategories = categories.filter(c =>
    type === 'transfer' ? true : c.type === (type === 'income' ? 'income' : 'expense')
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        {/* Type tabs */}
        <div className="flex border-b border-gray-100">
          {(['income', 'expense', 'transfer'] as TransactionType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                'flex-1 py-3.5 text-sm font-medium transition-colors first:rounded-tl-2xl last:rounded-tr-2xl',
                type === t
                  ? t === 'income'
                    ? 'bg-teal-500 text-white'
                    : t === 'expense'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              )}
            >
              {t === 'income' ? '+ Дохід' : t === 'expense' ? '− Витрата' : '⇄ Переказ'}
            </button>
          ))}
          <button onClick={onClose} className="px-4 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {/* Amount + Currency */}
          {type === 'transfer' ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-3 items-center">
                <span className="text-xs text-gray-500 w-20 shrink-0">Відправляю</span>
                <input
                  type="number"
                  placeholder="Сума"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  required
                />
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value as Currency)}
                  className="border border-gray-200 rounded-xl px-3 py-3 text-gray-800 focus:outline-none bg-gray-50"
                >
                  <option value="UAH">UAH (₴)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              <div className="flex gap-3 items-center">
                <span className="text-xs text-gray-500 w-20 shrink-0">Отримую</span>
                <input
                  type="number"
                  placeholder="Сума"
                  value={toAmount}
                  onChange={e => setToAmount(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                <select
                  value={toCurrency}
                  onChange={e => setToCurrency(e.target.value as Currency)}
                  className="border border-gray-200 rounded-xl px-3 py-3 text-gray-800 focus:outline-none bg-gray-50"
                >
                  <option value="UAH">UAH (₴)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <input
                type="number"
                placeholder="Сума"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
                required
              />
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as Currency)}
                className="border border-gray-200 rounded-xl px-3 py-3 text-gray-800 focus:outline-none bg-gray-50"
              >
                <option value="UAH">UAH (₴)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
          )}

          {/* Account */}
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
            required
          >
            <option value="">{type === 'expense' || type === 'transfer' ? 'З рахунку' : 'На рахунок'}</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
          </select>

          {/* To account (transfer) */}
          {type === 'transfer' && (
            <select
              value={toAccountId}
              onChange={e => setToAccountId(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
            >
              <option value="">На рахунок</option>
              {accounts.filter(a => a.id !== accountId).map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
              ))}
            </select>
          )}

          {/* Category */}
          {type !== 'transfer' && (
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
            >
              <option value="">Категорія</option>
              {filteredCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          {/* Project */}
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
          >
            <option value="">Проект</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Counterparty (expense) — the team is right in the list */}
          {type === 'expense' && (
            <div className="flex gap-2">
              <select
                value={counterpartyId}
                onChange={e => { setCounterpartyId(e.target.value); setNewCounterparty('') }}
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none bg-white"
              >
                <option value="">Кому (контрагент)</option>
                {teamMembers.length > 0 && (
                  <optgroup label="Команда">
                    {teamMembers.map(m => (
                      <option key={`team:${m.id}`} value={`team:${m.id}`}>{m.name}</option>
                    ))}
                  </optgroup>
                )}
                {counterparties.length > 0 && (
                  <optgroup label="Контрагенти">
                    {counterparties.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <input
                type="text"
                placeholder="Новий"
                value={newCounterparty}
                onChange={e => { setNewCounterparty(e.target.value); setCounterpartyId('') }}
                className="w-28 border border-gray-200 rounded-xl px-3 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400 text-sm"
              />
            </div>
          )}

          {/* Salary month: paying a team member closes that month as paid */}
          {type === 'expense' && counterpartyId.startsWith('team:') && !isEdit && (
            <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3 flex flex-col gap-2">
              <label className="text-xs text-teal-700 font-medium">
                Зарплата за місяць — усі затрекані години цього місяця стануть «оплачено»
              </label>
              <input
                type="month"
                value={salaryMonth}
                onChange={e => setSalaryMonth(e.target.value)}
                className="border border-teal-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none bg-white"
              />
              {!salaryMonth && (
                <p className="text-[11px] text-teal-600">Не обереш місяць — буде просто витрата без закриття годин</p>
              )}
            </div>
          )}

          {/* Date */}
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none"
          />

          {/* Comment */}
          <input
            type="text"
            placeholder="Коментар (опціонально)"
            value={comment}
            onChange={e => setComment(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none"
          />

          {/* Planned toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isPlanned}
              onChange={e => setIsPlanned(e.target.checked)}
              className="w-4 h-4 accent-teal-500"
            />
            <span className="text-sm text-gray-600">Плановий платіж</span>
          </label>

          {submitError && (
            <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              'w-full py-3.5 rounded-xl font-semibold text-white transition-opacity',
              loading ? 'opacity-50' : '',
              type === 'income'
                ? 'bg-gradient-to-r from-teal-400 to-teal-600'
                : type === 'expense'
                ? 'bg-gradient-to-r from-red-400 to-red-600'
                : 'bg-gradient-to-r from-gray-500 to-gray-700'
            )}
          >
            {loading ? 'Збереження...' : isEdit ? 'Зберегти зміни' : 'Зберегти'}
          </button>
        </form>
      </div>
    </div>
  )
}
