'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRates } from '@/lib/use-rates'
import EditTransactionModal from '@/components/modals/EditTransactionModal'
import type { Transaction } from '@/types'
import { Upload, ChevronDown, ChevronUp, CheckCircle, X, AlertTriangle, DollarSign, Plus, Edit2, Trash2, Users } from 'lucide-react'
import * as XLSX from 'xlsx'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Project  { id: string; name: string }
interface Account  { id: string; name: string; currency: string }
interface Employee { id: string; name: string; rate_usd: number }

interface EmployeeProjectRate {
  id: string
  employee_id: string
  project_id: string
  rate_usd: number
  projects?: { name: string } | null
}

interface PayrollItem {
  key: string
  employee: string
  projectRaw: string
  projectId: string
  projectName: string
  hoursDecimal: number
  rate: number
  amount: number
  matched: boolean
  isManual: boolean
}

interface PayrollRun {
  id: string
  label: string
  status: 'draft' | 'paid'
  total_amount: number
  currency: string
  account_id: string | null
  paid_at: string | null
  created_at: string
  payroll_items?: PayrollItemRow[]
  accounts?: { name: string } | null
}

interface PayrollItemRow {
  id: string
  employee_name: string
  project_name_raw: string | null
  hours_decimal: number
  rate_usd: number
  amount: number
  project_id: string | null
  transaction_id: string | null
  projects?: { name: string } | null
}

interface LeadManager {
  id: string
  name: string
  email: string
  is_active: boolean
  skip_payroll: boolean
  unpaid_usd: number
}

const PHASE_AMOUNTS: Record<string, number> = { sent: 0.5, reply: 2, call: 3, sale: 10 }

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTime(raw: string): number {
  if (!raw) return 0
  const s = String(raw).trim()
  // milliseconds (large integer)
  if (/^\d{6,}$/.test(s)) return Number(s) / 3600000
  // HH:MM:SS or H:MM:SS
  const hms = s.match(/^(\d+):(\d+):(\d+)$/)
  if (hms) return Number(hms[1]) + Number(hms[2]) / 60 + Number(hms[3]) / 3600
  // HH:MM or H:MM
  const hm = s.match(/^(\d+):(\d+)$/)
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60
  // "X h Y m" or "Xh Ym" (ClickUp style — space between digit and unit is optional)
  const hm2 = s.match(/(\d+)\s*h(?:\s*(\d+)\s*m)?/)
  if (hm2) return Number(hm2[1]) + (Number(hm2[2] ?? 0) / 60)
  // "X m" — minutes only
  const mOnly = s.match(/^(\d+)\s*m$/)
  if (mOnly) return Number(mOnly[1]) / 60
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
}

function fuzzyMatch(raw: string, projects: Project[]): Project | null {
  const n = normalize(raw)
  let m = projects.find(p => normalize(p.name) === n)
  if (m) return m
  m = projects.find(p => n.startsWith(normalize(p.name)) || normalize(p.name).startsWith(n))
  if (m) return m
  const words = n.split(' ').filter(w => w.length > 2)
  m = projects.find(p => {
    const pn = normalize(p.name)
    return words.some(w => pn.includes(w))
  })
  return m ?? null
}

// Rate priority: per-row rate > per-employee+project rate > employee default rate > global default
function parseFile(
  file: File,
  projects: Project[],
  defaultRate: number,
  employeeRates: Record<string, number>,
  employeeProjectRates: Record<string, Record<string, number>>,
): Promise<PayrollItem[]> {
  const isCSV = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv'

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        let rows: any[][]
        if (isCSV) {
          // CSV: read as plain text — avoids binary encoding quirks
          const wb = XLSX.read(e.target!.result as string, { type: 'string' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        } else {
          const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        }

        if (rows.length < 2) { resolve([]); return }

        const headers = rows[0].map(h => String(h).toLowerCase().trim())

        // Exact match takes priority over substring to avoid e.g. "user id" matching before "username"
        const findCol = (...names: string[]) => {
          for (const n of names) {
            const i = headers.findIndex(h => h === n)
            if (i >= 0) return i
          }
          for (const n of names) {
            const i = headers.findIndex(h => h.includes(n))
            if (i >= 0) return i
          }
          return -1
        }

        // ClickUp exports: Username / List Name / User Period Time Spent
        const empCol  = findCol('username', 'user', 'assignee', 'employee', 'name', 'виконавець', "ім'я")
        const projCol = findCol('list name', 'project', 'list', 'проект', 'завдання')
        const timeCol = findCol('user period time spent', 'time spent', 'logged', 'time tracked', 'tracked', 'time', 'duration', 'час', 'тривалість')
        const rateCol = findCol('rate', 'ставка')

        if (empCol < 0 || timeCol < 0) {
          const missing = [empCol < 0 && 'виконавець', timeCol < 0 && 'час'].filter(Boolean).join(', ')
          reject(new Error(`Не знайдено колонки: ${missing}. Заголовки у файлі: ${rows[0].slice(0,10).join(' | ')}`))
          return
        }

        const rawItems: PayrollItem[] = []
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          const employee   = String(row[empCol] ?? '').trim()
          const projectRaw = projCol >= 0 ? String(row[projCol] ?? '').trim() : ''
          const timeRaw    = String(row[timeCol] ?? '').trim()
          const rateRaw    = rateCol >= 0 ? parseFloat(String(row[rateCol])) : NaN

          if (!employee || !timeRaw) continue
          const hours = parseTime(timeRaw)
          if (hours <= 0) continue

          const matched = projectRaw ? fuzzyMatch(projectRaw, projects) : null
          const normEmp = normalize(employee)

          // Per-row > per-project > employee default > global default
          const projectRate = matched ? (employeeProjectRates[normEmp]?.[matched.id]) : undefined
          const empDefault  = employeeRates[normEmp]
          const rate = (!isNaN(rateRaw) && rateRaw > 0) ? rateRaw
            : (projectRate ?? empDefault ?? defaultRate)

          rawItems.push({
            key: `${employee}||${projectRaw}`,
            employee, projectRaw,
            projectId:   matched?.id   ?? '',
            projectName: matched?.name ?? '',
            hoursDecimal: Math.round(hours * 100) / 100,
            rate, amount: 0,
            matched: !!matched,
            isManual: false,
          })
        }

        // Aggregate rows by employee + project (multiple tasks → one preview line)
        const grouped: Record<string, PayrollItem> = {}
        for (const item of rawItems) {
          if (grouped[item.key]) {
            const g = grouped[item.key]
            g.hoursDecimal = Math.round((g.hoursDecimal + item.hoursDecimal) * 100) / 100
          } else {
            grouped[item.key] = { ...item }
          }
        }
        const items = Object.values(grouped).map(item => ({
          ...item,
          amount: Math.round(item.hoursDecimal * item.rate * 100) / 100,
        }))
        if (items.length === 0 && rawItems.length === 0) {
          reject(new Error(`Знайдено ${rows.length - 1} рядків, але жоден не розпізнано. Перевірте колонки: виконавець[${empCol}], проект[${projCol}], час[${timeCol}]`))
          return
        }
        resolve(items)
      } catch (err: any) {
        reject(new Error('Помилка парсингу файлу: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Помилка читання файлу'))
    if (isCSV) {
      reader.readAsText(file, 'utf-8')
    } else {
      reader.readAsArrayBuffer(file)
    }
  })
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const [runs, setRuns]                     = useState<PayrollRun[]>([])
  const [accounts, setAccounts]             = useState<Account[]>([])
  const [projects, setProjects]             = useState<Project[]>([])
  const [employees, setEmployees]           = useState<Employee[]>([])
  const [projectRates, setProjectRates]     = useState<EmployeeProjectRate[]>([])
  const [loading, setLoading]               = useState(true)
  const [uploadOpen, setUploadOpen]         = useState(false)
  const [manualOpen, setManualOpen]         = useState(false)
  const [expanded, setExpanded]             = useState<string | null>(null)
  const [leadManagers, setLeadManagers]     = useState<LeadManager[]>([])
  const [payingManager, setPayingManager]   = useState<LeadManager | null>(null)
  const [editingTx, setEditingTx]           = useState<Transaction | null>(null)
  const { rates }                           = useRates()

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: r }, { data: a }, { data: p }, { data: e }, { data: pr }, { data: mgrs }, { data: unpaidLeads }] = await Promise.all([
      supabase.from('payroll_runs')
        .select('*, payroll_items(*, projects(name)), accounts(name)')
        .order('created_at', { ascending: false }),
      supabase.from('accounts').select('id,name,currency').order('created_at'),
      supabase.from('projects').select('id,name').neq('status', 'archived').order('name'),
      supabase.from('employees').select('*').order('name'),
      supabase.from('employee_project_rates').select('*, projects(name)'),
      supabase.from('lead_managers').select('id,name,email,is_active,skip_payroll').order('name'),
      supabase.from('leads').select('manager_id,phase_sent,phase_reply,phase_call,phase_sale,is_earnings_paid'),
    ])
    if (r)  setRuns(r as PayrollRun[])
    if (a)  setAccounts(a)
    if (p)  setProjects(p)
    if (e)  setEmployees(e)
    if (pr) setProjectRates(pr as EmployeeProjectRate[])
    if (mgrs) {
      const earningsMap: Record<string, number> = {}
      for (const lead of (unpaidLeads ?? []) as any[]) {
        if (lead.is_earnings_paid) continue
        const amt = (lead.phase_sent ? PHASE_AMOUNTS.sent : 0)
          + (lead.phase_reply ? PHASE_AMOUNTS.reply : 0)
          + (lead.phase_call  ? PHASE_AMOUNTS.call  : 0)
          + (lead.phase_sale  ? PHASE_AMOUNTS.sale  : 0)
        earningsMap[lead.manager_id] = (earningsMap[lead.manager_id] ?? 0) + amt
      }
      setLeadManagers(
        (mgrs as any[])
          .filter(m => !m.skip_payroll)
          .map(m => ({ ...m, unpaid_usd: earningsMap[m.id] ?? 0 }))
      )
    }
    setLoading(false)
  }

  async function deleteRun(id: string) {
    await supabase.from('payroll_runs').delete().eq('id', id)
    fetchAll()
  }

  async function handleEditTx(txId: string) {
    const { data } = await supabase.from('transactions').select('*').eq('id', txId).single()
    if (data) setEditingTx(data as Transaction)
  }

  const drafts    = runs.filter(r => r.status === 'draft')
  const paid      = runs.filter(r => r.status === 'paid')
  const totalPaid = paid.reduce((s, r) => s + r.total_amount, 0)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Зарплата команді</h1>
          <p className="text-sm text-gray-500 mt-0.5">Виплати по проектах</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setManualOpen(true)}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={14} /> Нарахувати вручну
          </button>
          <button onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Upload size={14} /> Завантажити CSV / Excel
          </button>
        </div>
      </div>

      <EmployeesPanel
        employees={employees}
        projects={projects}
        projectRates={projectRates}
        onRefresh={fetchAll}
      />

      <LeadManagersSection
        managers={leadManagers}
        usdRate={rates.USD}
        onPay={mgr => setPayingManager(mgr)}
      />

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 text-white rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Виплачено (всього)</p>
          <p className="text-2xl font-bold">${totalPaid.toLocaleString('en-US', { maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
          <p className="text-xs text-gray-500 mb-1">Очікує оплати</p>
          <p className="text-2xl font-bold text-amber-700">{drafts.length}</p>
          <p className="text-xs text-gray-400 mt-1">розрахунків</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Виплат всього</p>
          <p className="text-2xl font-bold text-gray-900">{paid.length}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-center py-12 text-gray-400">Завантаження...</p>
      ) : (
        <>
          {drafts.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Очікують оплати</h2>
              <div className="flex flex-col gap-3">
                {drafts.map(run => (
                  <RunCard key={run.id} run={run} expanded={expanded === run.id}
                    onToggle={() => setExpanded(e => e === run.id ? null : run.id)}
                    onDelete={() => deleteRun(run.id)}
                    projects={projects} onRefresh={fetchAll}
                    accounts={accounts} rates={rates} onEditTx={handleEditTx} />
                ))}
              </div>
            </div>
          )}
          {paid.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Виплачені</h2>
              <div className="flex flex-col gap-3">
                {paid.map(run => (
                  <RunCard key={run.id} run={run} expanded={expanded === run.id}
                    onToggle={() => setExpanded(e => e === run.id ? null : run.id)}
                    onDelete={() => deleteRun(run.id)}
                    projects={projects} onRefresh={fetchAll}
                    accounts={accounts} rates={rates} onEditTx={handleEditTx} />
                ))}
              </div>
            </div>
          )}
          {runs.length === 0 && (
            <div className="text-center py-20 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
              <DollarSign size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium text-gray-500">Немає розрахунків</p>
              <p className="text-sm mt-1">Завантажте CSV або Excel, або додайте вручну</p>
            </div>
          )}
        </>
      )}

      {uploadOpen && (
        <UploadModal
          projects={projects} accounts={accounts}
          employees={employees} projectRates={projectRates}
          onClose={() => setUploadOpen(false)}
          onSuccess={() => { setUploadOpen(false); fetchAll() }}
        />
      )}
      {manualOpen && (
        <ManualPayrollModal
          employees={employees} projects={projects} accounts={accounts}
          onClose={() => setManualOpen(false)}
          onSuccess={() => { setManualOpen(false); fetchAll() }}
        />
      )}
      {payingManager && (
        <LeadManagerPayModal
          manager={payingManager}
          accounts={accounts}
          usdRate={rates.USD}
          onClose={() => setPayingManager(null)}
          onSuccess={() => { setPayingManager(null); fetchAll() }}
        />
      )}
      {editingTx && (
        <EditTransactionModal
          transaction={editingTx}
          onClose={() => setEditingTx(null)}
          onSuccess={() => { setEditingTx(null); fetchAll() }}
        />
      )}
    </div>
  )
}

// ── Employees Panel ────────────────────────────────────────────────────────────

function EmployeesPanel({ employees, projects, projectRates, onRefresh }: {
  employees: Employee[]
  projects: Project[]
  projectRates: EmployeeProjectRate[]
  onRefresh: () => void
}) {
  const [open, setOpen]           = useState(false)
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName]   = useState('')
  const [editRate, setEditRate]   = useState('')
  const [addName, setAddName]     = useState('')
  const [addRate, setAddRate]     = useState('')
  const [saving, setSaving]       = useState(false)
  // per-project rate add form state per employee
  const [addProjId, setAddProjId]   = useState<Record<string, string>>({})
  const [addProjRate, setAddProjRate] = useState<Record<string, string>>({})

  function startEdit(emp: Employee) {
    setEditingId(emp.id)
    setEditName(emp.name)
    setEditRate(String(emp.rate_usd))
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    setSaving(true)
    await supabase.from('employees').update({ name: editName.trim(), rate_usd: parseFloat(editRate) || 0 }).eq('id', id)
    setEditingId(null)
    setSaving(false)
    onRefresh()
  }

  async function addEmployee() {
    if (!addName.trim()) return
    setSaving(true)
    await supabase.from('employees').insert({ name: addName.trim(), rate_usd: parseFloat(addRate) || 0 })
    setAddName(''); setAddRate('')
    setSaving(false)
    onRefresh()
  }

  async function deleteEmployee(id: string) {
    await supabase.from('employees').delete().eq('id', id)
    onRefresh()
  }

  async function addProjectRate(empId: string) {
    const projId = addProjId[empId]
    const rate   = parseFloat(addProjRate[empId] ?? '')
    if (!projId || isNaN(rate) || rate <= 0) return
    await supabase.from('employee_project_rates').upsert({
      employee_id: empId, project_id: projId, rate_usd: rate,
    }, { onConflict: 'employee_id,project_id' })
    setAddProjId(p => ({ ...p, [empId]: '' }))
    setAddProjRate(p => ({ ...p, [empId]: '' }))
    onRefresh()
  }

  async function deleteProjectRate(id: string) {
    await supabase.from('employee_project_rates').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div className="border border-gray-200 rounded-xl mb-6 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2 text-sm">
          <Users size={15} className="text-gray-500" />
          <span className="font-medium text-gray-800">Команда</span>
          <span className="text-gray-400">{employees.length} співробітників</span>
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {employees.map(emp => {
            const empRates = projectRates.filter(r => r.employee_id === emp.id)
            const isExpanded = expandedEmp === emp.id
            const usedProjectIds = new Set(empRates.map(r => r.project_id))
            const availableProjects = projects.filter(p => !usedProjectIds.has(p.id))

            return (
              <div key={emp.id}>
                {/* Employee row */}
                <div className="flex items-center gap-2 px-4 py-3 group">
                  {/* Expand toggle */}
                  <button
                    onClick={() => setExpandedEmp(isExpanded ? null : emp.id)}
                    className="text-gray-300 hover:text-gray-600 transition-colors p-0.5 flex-shrink-0"
                    title="Рейти по проектах">
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {editingId === emp.id ? (
                    <>
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                      <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                        <span>базовий</span>
                        <input type="number" step="0.5" min="0" value={editRate} onChange={e => setEditRate(e.target.value)}
                          className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-900" />
                        <span>$/год</span>
                      </div>
                      <button onClick={() => saveEdit(emp.id)} disabled={saving}
                        className="text-teal-600 text-xs font-medium hover:text-teal-700 px-2">Зберегти</button>
                      <button onClick={() => setEditingId(null)} className="text-gray-400 text-xs hover:text-gray-600">✕</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium text-gray-800">{emp.name}</span>
                      <span className="text-sm text-gray-400 flex-shrink-0">
                        ${emp.rate_usd}/год
                        {empRates.length > 0 && (
                          <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                            +{empRates.length} проект{empRates.length === 1 ? '' : 'и'}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(emp)}
                          className="text-gray-400 hover:text-gray-700 p-1 transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => deleteEmployee(emp.id)}
                          className="text-gray-400 hover:text-red-500 p-1 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Per-project rates (expanded) */}
                {isExpanded && (
                  <div className="bg-gray-50 px-4 pb-3 pt-1 ml-6 border-l border-gray-200">
                    {empRates.length > 0 && (
                      <table className="w-full text-xs mb-3">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-200">
                            <th className="text-left py-1.5 font-medium">Проект</th>
                            <th className="text-right py-1.5 font-medium">$/год</th>
                            <th className="w-6" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {empRates.map(pr => (
                            <tr key={pr.id}>
                              <td className="py-1.5 text-gray-700">{pr.projects?.name ?? '—'}</td>
                              <td className="py-1.5 text-right text-gray-600 font-medium">${pr.rate_usd}/год</td>
                              <td className="py-1.5 text-right">
                                <button onClick={() => deleteProjectRate(pr.id)}
                                  className="text-gray-300 hover:text-red-400 transition-colors p-0.5">
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {availableProjects.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={addProjId[emp.id] ?? ''}
                          onChange={e => setAddProjId(p => ({ ...p, [emp.id]: e.target.value }))}
                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none bg-white">
                          <option value="">Обрати проект...</option>
                          {availableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <input
                          type="number" step="0.5" min="0" placeholder="$/год"
                          value={addProjRate[emp.id] ?? ''}
                          onChange={e => setAddProjRate(p => ({ ...p, [emp.id]: e.target.value }))}
                          className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-gray-900"
                        />
                        <button
                          onClick={() => addProjectRate(emp.id)}
                          disabled={!addProjId[emp.id] || !addProjRate[emp.id]}
                          className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors">
                          <Plus size={11} /> Додати
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">Рейти вказані для всіх проектів</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Add employee */}
          <div className="px-4 py-3 flex gap-2 items-center bg-white">
            <div className="w-4 flex-shrink-0" />
            <input placeholder="Ім'я нового співробітника" value={addName} onChange={e => setAddName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addEmployee() }}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
              <span>базовий</span>
              <input type="number" step="0.5" min="0" placeholder="$/год" value={addRate} onChange={e => setAddRate(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addEmployee() }}
                className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <button onClick={addEmployee} disabled={saving || !addName.trim()}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors flex-shrink-0">
              <Plus size={14} /> Додати
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Run Card ───────────────────────────────────────────────────────────────────

type EditState = { projectId: string; rate: number; hours: number; amount: number }

function RunCard({ run, expanded, onToggle, onDelete, projects, onRefresh, accounts, rates, onEditTx }: {
  run: PayrollRun; expanded: boolean
  onToggle: () => void; onDelete: () => void
  projects: Project[]; onRefresh: () => void
  accounts: Account[]; rates: { USD: number }; onEditTx: (txId: string) => void
}) {
  const isDraft = run.status === 'draft'
  const items   = run.payroll_items ?? []

  const [edits, setEdits]   = useState<Record<string, EditState>>(() => {
    const init: Record<string, EditState> = {}
    for (const item of items) {
      init[item.id] = { projectId: item.project_id ?? '', rate: item.rate_usd, hours: item.hours_decimal, amount: item.amount }
    }
    return init
  })
  const [paying, setPaying] = useState<string | null>(null)
  const [pendingPay, setPendingPay] = useState<string | null>(null)

  // Sync edits when items refresh (preserve unsaved edits for unpaid items)
  useEffect(() => {
    setEdits(prev => {
      const next: Record<string, EditState> = {}
      for (const item of items) {
        next[item.id] = (prev[item.id] && !item.transaction_id)
          ? prev[item.id]
          : { projectId: item.project_id ?? '', rate: item.rate_usd, hours: item.hours_decimal, amount: item.amount }
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, items.length])

  function updateEdit(itemId: string, patch: Partial<EditState>) {
    setEdits(prev => {
      const cur  = prev[itemId] ?? { projectId: '', rate: 0, hours: 0, amount: 0 }
      const next = { ...cur, ...patch }
      next.amount = Math.round(next.hours * next.rate * 100) / 100
      return { ...prev, [itemId]: next }
    })
  }

  async function saveItemToDb(itemId: string) {
    const edit = edits[itemId]
    if (!edit) return
    await supabase.from('payroll_items').update({
      project_id:    edit.projectId || null,
      rate_usd:      edit.rate,
      hours_decimal: edit.hours,
      amount:        edit.amount,
    }).eq('id', itemId)
  }

  async function payEmployee(empName: string, exchangeRate?: number) {
    if (!run.account_id) { alert('Оберіть рахунок для списання'); return }
    setPaying(empName)

    const account = accounts.find(a => a.id === run.account_id)
    const needsConversion = account && account.currency !== run.currency

    const empItems = items.filter(i => i.employee_name === empName && !i.transaction_id)
    for (const item of empItems) {
      await saveItemToDb(item.id)
      const edit   = edits[item.id]
      const amount = edit?.amount ?? item.amount
      const hours  = edit?.hours  ?? item.hours_decimal
      const rate   = edit?.rate   ?? item.rate_usd
      const projId = edit?.projectId || item.project_id || null

      let txAmount   = amount
      let txCurrency = run.currency
      if (needsConversion && exchangeRate && exchangeRate > 0) {
        txAmount   = Math.round(amount * exchangeRate * 100) / 100
        txCurrency = account!.currency
      }

      const comment = hours > 0
        ? `ЗП ${empName} — ${run.label}, ${hours}h × $${rate}`
        : `ЗП ${empName} — ${run.label}`

      const { data: tx } = await supabase.from('transactions').insert({
        type: 'expense', amount: txAmount, currency: txCurrency,
        account_id: run.account_id,
        project_id: projId,
        date: new Date().toISOString(),
        comment, is_planned: false,
      }).select('id').single()

      await supabase.rpc('update_account_balance', { p_account_id: run.account_id, p_delta: -txAmount })
      if (tx) await supabase.from('payroll_items').update({ transaction_id: tx.id }).eq('id', item.id)
    }

    // Recalculate total + check if fully paid
    const { data: allItems } = await supabase
      .from('payroll_items').select('id,amount,transaction_id').eq('run_id', run.id)
    if (allItems) {
      const allPaid = allItems.every(i => i.transaction_id)
      const total   = Math.round(allItems.reduce((s, i) => s + i.amount, 0) * 100) / 100
      const upd: Record<string, unknown> = { total_amount: total }
      if (allPaid) { upd.status = 'paid'; upd.paid_at = new Date().toISOString() }
      await supabase.from('payroll_runs').update(upd).eq('id', run.id)
    }

    setPaying(null)
    onRefresh()
  }

  function handlePayClick(empName: string) {
    const account = accounts.find(a => a.id === run.account_id)
    if (account && account.currency !== run.currency) {
      setPendingPay(empName)
    } else {
      payEmployee(empName)
    }
  }

  // Group by employee for draft view
  const byEmployee: Record<string, PayrollItemRow[]> = {}
  if (isDraft) {
    for (const item of items) {
      if (!byEmployee[item.employee_name]) byEmployee[item.employee_name] = []
      byEmployee[item.employee_name].push(item)
    }
  }

  // Group by project for paid view
  const byProject: Record<string, { name: string; items: PayrollItemRow[]; total: number }> = {}
  if (!isDraft) {
    for (const item of items) {
      const key   = item.project_id ?? '__none__'
      const pName = item.projects?.name ?? item.project_name_raw ?? '—'
      if (!byProject[key]) byProject[key] = { name: pName, items: [], total: 0 }
      byProject[key].items.push(item)
      byProject[key].total += item.amount
    }
  }

  return (
    <>
    <div className={`border rounded-xl overflow-hidden ${isDraft ? 'border-amber-200' : 'border-gray-200'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 cursor-pointer ${isDraft ? 'bg-amber-50' : 'bg-gray-50'}`}
        onClick={onToggle}>
        <div className="flex items-center gap-3">
          {expanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
          <div>
            <span className="font-medium text-gray-900 text-sm">{run.label}</span>
            {run.accounts && <span className="text-xs text-gray-400 ml-2">· {run.accounts.name}</span>}
          </div>
          {isDraft
            ? <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-medium">чернетка</span>
            : <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                <CheckCircle size={10} className="inline mr-0.5" />
                {run.paid_at ? new Date(run.paid_at).toLocaleDateString('uk-UA') : 'оплачено'}
              </span>
          }
        </div>
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">${run.total_amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="text-gray-300 hover:text-red-400 transition-colors p-1">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Draft expanded: grouped by employee, editable rows */}
      {expanded && isDraft && (
        <div className="p-4 bg-white flex flex-col gap-3">
          {Object.entries(byEmployee).map(([empName, empItems]) => {
            const allPaid  = empItems.every(i => i.transaction_id)
            const empTotal = empItems.reduce((s, i) => s + (edits[i.id]?.amount ?? i.amount), 0)

            return (
              <div key={empName} className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-800">{empName}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-red-500">${empTotal.toFixed(2)}</span>
                    {allPaid ? (
                      <span className="flex items-center gap-1 text-xs bg-teal-100 text-teal-700 px-2.5 py-1 rounded-lg font-medium">
                        <CheckCircle size={10} /> Оплачено
                      </span>
                    ) : (
                      <button
                        onClick={() => handlePayClick(empName)}
                        disabled={paying !== null}
                        className="text-xs bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                        {paying === empName ? 'Оплата...' : 'Оплатити'}
                      </button>
                    )}
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-white">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Проект</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Год.</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">$/год</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Сума</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empItems.map(item => {
                      const edit   = edits[item.id] ?? { projectId: item.project_id ?? '', rate: item.rate_usd, hours: item.hours_decimal, amount: item.amount }
                      const isPaid = !!item.transaction_id

                      return (
                        <tr key={item.id} className={`border-b border-gray-50 last:border-0 ${isPaid ? 'bg-teal-50/30' : ''}`}>
                          <td className="py-1.5 px-3">
                            {isPaid
                              ? <span className="text-gray-600">{item.projects?.name ?? item.project_name_raw ?? '—'}</span>
                              : <select
                                  value={edit.projectId}
                                  onChange={e => updateEdit(item.id, { projectId: e.target.value })}
                                  onBlur={() => saveItemToDb(item.id)}
                                  className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none bg-white">
                                  <option value="">— без проекту —</option>
                                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            }
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {isPaid
                              ? <span className="text-gray-500">{item.hours_decimal > 0 ? `${item.hours_decimal}h` : '—'}</span>
                              : <input type="number" step="0.01" min="0"
                                  value={edit.hours}
                                  onChange={e => updateEdit(item.id, { hours: parseFloat(e.target.value) || 0 })}
                                  onBlur={() => saveItemToDb(item.id)}
                                  className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                            }
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {isPaid
                              ? <span className="text-gray-500">{item.rate_usd > 0 ? `$${item.rate_usd}` : 'фікс.'}</span>
                              : <input type="number" step="0.5" min="0"
                                  value={edit.rate}
                                  onChange={e => updateEdit(item.id, { rate: parseFloat(e.target.value) || 0 })}
                                  onBlur={() => saveItemToDb(item.id)}
                                  className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                            }
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <span className={`font-semibold ${isPaid ? 'text-teal-600' : 'text-red-500'}`}>
                              ${(isPaid ? item.amount : edit.amount).toFixed(2)}
                            </span>
                            {isPaid && <CheckCircle size={9} className="inline ml-1 text-teal-400" />}
                            {isPaid && item.transaction_id && (
                              <button onClick={() => onEditTx(item.transaction_id!)}
                                className="text-gray-300 hover:text-gray-600 transition-colors ml-1" title="Редагувати транзакцію">
                                <Edit2 size={9} className="inline" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {/* Paid expanded: grouped by project, read-only */}
      {expanded && !isDraft && (
        <div className="p-4 bg-white flex flex-col gap-4">
          {Object.entries(byProject).map(([key, group]) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{group.name}</p>
                <span className="text-xs font-semibold text-red-500">${group.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="bg-gray-50 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Виконавець</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Год.</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Ставка</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Сума</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(item => (
                      <tr key={item.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 px-3 text-gray-700 font-medium">{item.employee_name}</td>
                        <td className="py-2 px-3 text-right text-gray-500">
                          {item.hours_decimal > 0 ? `${item.hours_decimal}h` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-500">
                          {item.rate_usd > 0 ? `$${item.rate_usd}/h` : 'фікс.'}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <span className="font-semibold text-red-500">${item.amount.toFixed(2)}</span>
                          {item.transaction_id && (
                            <button onClick={() => onEditTx(item.transaction_id!)}
                              className="text-gray-300 hover:text-gray-600 transition-colors ml-1.5" title="Редагувати транзакцію">
                              <Edit2 size={10} className="inline" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    {pendingPay && (
      <PayConfirmModal
        empName={pendingPay}
        empTotal={items
          .filter(i => i.employee_name === pendingPay && !i.transaction_id)
          .reduce((s, i) => s + (edits[i.id]?.amount ?? i.amount), 0)}
        runCurrency={run.currency}
        accountCurrency={accounts.find(a => a.id === run.account_id)?.currency ?? run.currency}
        defaultRate={rates.USD}
        onConfirm={rate => { setPendingPay(null); payEmployee(pendingPay, rate) }}
        onClose={() => setPendingPay(null)}
      />
    )}
    </>
  )
}

// ── Pay Confirm Modal ──────────────────────────────────────────────────────────

function PayConfirmModal({ empName, empTotal, runCurrency, accountCurrency, defaultRate, onConfirm, onClose }: {
  empName: string; empTotal: number
  runCurrency: string; accountCurrency: string
  defaultRate: number
  onConfirm: (rate: number) => void; onClose: () => void
}) {
  const [rate, setRate] = useState(defaultRate > 0 ? defaultRate.toFixed(4) : '')
  const rateNum   = parseFloat(rate)
  const converted = rateNum > 0 ? Math.round(empTotal * rateNum * 100) / 100 : 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Оплата зарплати</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="bg-gray-50 rounded-xl px-4 py-3 flex justify-between items-center">
            <p className="text-sm font-semibold text-gray-800">{empName}</p>
            <p className="font-bold text-gray-900">{empTotal.toFixed(2)} {runCurrency}</p>
          </div>
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
            Рахунок у <strong>{accountCurrency}</strong>, зарплата у <strong>{runCurrency}</strong> — вкажіть курс конвертації
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              1 {runCurrency} = ? {accountCurrency}
            </label>
            <input
              type="number" step="0.01" min="0"
              value={rate}
              onChange={e => setRate(e.target.value)}
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {converted > 0 && (
              <p className="text-xs text-gray-500 mt-1 text-right">
                = {converted.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} {accountCurrency}
              </p>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose}
            className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition-colors">
            Скасувати
          </button>
          <button
            onClick={() => { if (rateNum > 0) onConfirm(rateNum) }}
            disabled={!(rateNum > 0)}
            className="bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors">
            {converted > 0 ? `Оплатити ${converted.toFixed(2)} ${accountCurrency}` : 'Оплатити'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Manual Payroll Modal ───────────────────────────────────────────────────────

interface ManualEntry { id: string; employee: string; projectId: string; hours: string; minutes: string; rate: string }

function entryHoursDecimal(e: ManualEntry) {
  const h = parseInt(e.hours) || 0
  const m = Math.min(parseInt(e.minutes) || 0, 59)
  return h + m / 60
}

function entryAmount(e: ManualEntry) {
  const hd = entryHoursDecimal(e)
  const r  = parseFloat(e.rate)
  return (hd > 0 && !isNaN(r) && r > 0) ? Math.round(hd * r * 100) / 100 : 0
}

function ManualPayrollModal({ employees, projects, accounts, onClose, onSuccess }: {
  employees: Employee[]; projects: Project[]; accounts: Account[]
  onClose: () => void; onSuccess: () => void
}) {
  const defaultLabel = `ЗП ${new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' }).format(new Date())}`
  const [label, setLabel]         = useState(defaultLabel)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [entries, setEntries]     = useState<ManualEntry[]>([{ id: '1', employee: '', projectId: '', hours: '', minutes: '', rate: '' }])
  const [saving, setSaving]       = useState(false)

  function addRow() {
    setEntries(prev => [...prev, { id: String(Date.now()), employee: '', projectId: '', hours: '', minutes: '', rate: '' }])
  }

  function updateRow(id: string, patch: Partial<ManualEntry>) {
    setEntries(prev => prev.map(e => {
      if (e.id !== id) return e
      const updated = { ...e, ...patch }
      if (patch.employee !== undefined && !updated.rate) {
        const match = employees.find(emp => emp.name.toLowerCase() === updated.employee.toLowerCase())
        if (match && match.rate_usd > 0) updated.rate = String(match.rate_usd)
      }
      return updated
    }))
  }

  function removeRow(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  async function save() {
    const valid = entries.filter(e => e.employee.trim() && entryAmount(e) > 0)
    if (valid.length === 0) return
    setSaving(true)

    const total = valid.reduce((s, e) => s + entryAmount(e), 0)
    const { data: run } = await supabase.from('payroll_runs').insert({
      label: label.trim() || defaultLabel,
      status: 'draft',
      total_amount: Math.round(total * 100) / 100,
      currency: 'USD',
      account_id: accountId || null,
    }).select('id').single()

    if (!run) { setSaving(false); return }

    await supabase.from('payroll_items').insert(
      valid.map(e => ({
        run_id: run.id,
        employee_name: e.employee.trim(),
        project_id: e.projectId || null,
        project_name_raw: projects.find(p => p.id === e.projectId)?.name ?? null,
        hours_decimal: Math.round(entryHoursDecimal(e) * 100) / 100,
        rate_usd: parseFloat(e.rate) || 0,
        amount: entryAmount(e),
      }))
    )
    onSuccess()
  }

  const total = entries.reduce((s, e) => s + entryAmount(e), 0)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Нарахувати вручну</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 border-b border-gray-100 flex gap-4 flex-shrink-0 bg-gray-50">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Назва виплати</label>
            <input value={label} onChange={e => setLabel(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div className="w-52">
            <label className="block text-xs text-gray-500 mb-1">Рахунок для списання</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none bg-white">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="text-left pb-2 font-medium">Співробітник</th>
                <th className="text-left pb-2 font-medium">Проект</th>
                <th className="text-right pb-2 font-medium w-36">Час</th>
                <th className="text-right pb-2 font-medium w-24">$/год</th>
                <th className="text-right pb-2 font-medium w-24">Сума ($)</th>
                <th className="w-6 pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(entry => {
                const amt = entryAmount(entry)
                return (
                  <tr key={entry.id}>
                    <td className="py-2 pr-2">
                      <input
                        list={`emp-list-${entry.id}`}
                        placeholder="Ім'я"
                        value={entry.employee}
                        onChange={e => updateRow(entry.id, { employee: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                      <datalist id={`emp-list-${entry.id}`}>
                        {employees.map(e => <option key={e.id} value={e.name} />)}
                      </datalist>
                    </td>
                    <td className="py-2 pr-2">
                      <select value={entry.projectId} onChange={e => updateRow(entry.id, { projectId: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none bg-white">
                        <option value="">— без проекту —</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" placeholder="0"
                          value={entry.hours}
                          onChange={e => updateRow(entry.id, { hours: e.target.value })}
                          className="w-12 border border-gray-200 rounded-lg px-1.5 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-900" />
                        <span className="text-xs text-gray-400 shrink-0">г</span>
                        <input type="number" min="0" max="59" placeholder="0"
                          value={entry.minutes}
                          onChange={e => updateRow(entry.id, { minutes: e.target.value })}
                          className="w-12 border border-gray-200 rounded-lg px-1.5 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-900" />
                        <span className="text-xs text-gray-400 shrink-0">хв</span>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <input type="number" step="0.5" min="0" placeholder="0"
                        value={entry.rate}
                        onChange={e => updateRow(entry.id, { rate: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-900" />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <span className={`text-sm font-semibold ${amt > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                        ${amt.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2 text-center">
                      {entries.length > 1 && (
                        <button onClick={() => removeRow(entry.id)} className="text-gray-300 hover:text-red-400 transition-colors p-1">
                          <X size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <button onClick={addRow}
            className="mt-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <Plus size={14} /> Додати рядок
          </button>
        </div>

        <div className="flex items-center justify-between p-5 border-t border-gray-100 flex-shrink-0">
          <div className="text-sm">
            <span className="text-gray-500">Всього: </span>
            <span className="font-bold text-gray-900">${total.toFixed(2)}</span>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition-colors">
              Скасувати
            </button>
            <button onClick={save} disabled={saving || total === 0}
              className="bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors">
              {saving ? 'Збереження...' : 'Зберегти чернетку'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Upload Modal ───────────────────────────────────────────────────────────────

function UploadModal({ projects, accounts, employees, projectRates, onClose, onSuccess }: {
  projects: Project[]; accounts: Account[]
  employees: Employee[]; projectRates: EmployeeProjectRate[]
  onClose: () => void; onSuccess: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep]             = useState<'upload' | 'preview'>('upload')
  const [items, setItems]           = useState<PayrollItem[]>([])
  const [parseError, setParseError] = useState('')
  const [label, setLabel]           = useState(`ЗП ${new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' }).format(new Date())}`)
  const [accountId, setAccountId]   = useState(accounts[0]?.id ?? '')
  const [globalRate, setGlobalRate] = useState('7')
  const [saving, setSaving]         = useState(false)
  const [dragging, setDragging]     = useState(false)

  // Build rate lookups
  const employeeRates: Record<string, number> = {}
  for (const emp of employees) {
    employeeRates[normalize(emp.name)] = emp.rate_usd
  }

  // employeeProjectRates[normName][projectId] = rate
  const empProjRates: Record<string, Record<string, number>> = {}
  for (const pr of projectRates) {
    const emp = employees.find(e => e.id === pr.employee_id)
    if (!emp) continue
    const normName = normalize(emp.name)
    if (!empProjRates[normName]) empProjRates[normName] = {}
    empProjRates[normName][pr.project_id] = pr.rate_usd
  }

  async function handleFile(file: File) {
    setParseError('')
    try {
      const parsed = await parseFile(file, projects, Number(globalRate) || 7, employeeRates, empProjRates)
      if (parsed.length === 0) { setParseError('Файл порожній або не вдалося розпізнати рядки'); return }
      setItems(parsed)
      setStep('preview')
    } catch (err: any) {
      setParseError(err.message)
    }
  }

  function updateItem(key: string, patch: Partial<PayrollItem>) {
    setItems(prev => prev.map(i => i.key === key ? { ...i, ...patch,
      amount: Math.round(((patch.hoursDecimal ?? i.hoursDecimal) * (patch.rate ?? i.rate)) * 100) / 100
    } : i))
  }

  function removeItem(key: string) {
    setItems(prev => prev.filter(i => i.key !== key))
  }

  async function save() {
    if (!label.trim()) return
    setSaving(true)
    const total = items.reduce((s, i) => s + i.amount, 0)

    const { data: run, error } = await supabase.from('payroll_runs').insert({
      label: label.trim(), status: 'draft',
      total_amount: Math.round(total * 100) / 100,
      currency: 'USD', account_id: accountId || null,
    }).select('id').single()

    if (error || !run) { setSaving(false); return }

    await supabase.from('payroll_items').insert(
      items.map(i => ({
        run_id: run.id,
        employee_name: i.employee,
        project_id:    i.projectId || null,
        project_name_raw: i.projectRaw,
        hours_decimal: i.hoursDecimal,
        rate_usd:      i.rate,
        amount:        i.amount,
      }))
    )
    onSuccess()
  }

  const total     = items.reduce((s, i) => s + i.amount, 0)
  const unmatched = items.filter(i => i.projectRaw && !i.projectId).length

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {step === 'upload' ? 'Завантажити табель' : 'Перевірка перед збереженням'}
            </h2>
            {step === 'preview' && (
              <p className="text-xs text-gray-400 mt-0.5">{items.length} рядків · ${total.toFixed(2)}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {step === 'upload' && (
          <div className="p-6 flex flex-col gap-5">
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${dragging ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <Upload size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm font-medium text-gray-600">Перетягніть CSV або Excel файл</p>
              <p className="text-xs text-gray-400 mt-1">або натисніть щоб вибрати</p>
              <p className="text-xs text-gray-300 mt-2">Підтримуються: .csv, .xlsx, .xls</p>
              <input ref={fileRef} type="file" className="hidden" accept=".csv,.xlsx,.xls"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </div>

            {parseError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-600">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Помилка парсингу</p>
                  <p className="text-xs mt-0.5">{parseError}</p>
                  <p className="text-xs mt-1 text-red-400">Потрібні колонки: виконавець (user/assignee/employee) та час (time/logged/tracked)</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Ставка за замовчуванням ($/год)
                  {employees.length > 0 && <span className="font-normal text-gray-400 ml-1">— якщо не вказано</span>}
                </label>
                <input type="number" step="0.5" min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  value={globalRate} onChange={e => setGlobalRate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Рахунок для списання</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                  value={accountId} onChange={e => setAccountId(e.target.value)}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                </select>
              </div>
            </div>

            {employees.length > 0 && (
              <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 text-xs text-teal-700 leading-relaxed">
                <span className="font-medium">Пріоритет ставок:</span> ставка з файлу → ставка по проекту → базова ставка → за замовчуванням
              </div>
            )}
          </div>
        )}

        {step === 'preview' && (
          <>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4 flex-shrink-0 bg-gray-50">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-0.5">Назва виплати</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  value={label} onChange={e => setLabel(e.target.value)} />
              </div>
              <div className="w-48">
                <label className="block text-xs text-gray-500 mb-0.5">Рахунок</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white"
                  value={accountId} onChange={e => setAccountId(e.target.value)}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {unmatched > 0 && (
                <div className="flex items-center gap-1 text-amber-600 text-xs bg-amber-50 px-2 py-1 rounded-lg">
                  <AlertTriangle size={12} />
                  {unmatched} не розпізнано
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
                  <tr>
                    <th className="text-left py-2 px-4 text-xs font-medium text-gray-500">Виконавець</th>
                    <th className="text-left py-2 px-4 text-xs font-medium text-gray-500">Проект</th>
                    <th className="text-right py-2 px-4 text-xs font-medium text-gray-500">Год.</th>
                    <th className="text-right py-2 px-4 text-xs font-medium text-gray-500">$/год</th>
                    <th className="text-right py-2 px-4 text-xs font-medium text-gray-500">Сума</th>
                    <th className="w-6 py-2 px-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map(item => (
                    <tr key={item.key} className={`${!item.matched && item.projectRaw ? 'bg-amber-50/50' : ''}`}>
                      <td className="py-2 px-4 text-gray-700 font-medium">{item.employee}</td>
                      <td className="py-2 px-4">
                        <select
                          className={`w-full border rounded-lg px-2 py-1 text-xs focus:outline-none bg-white ${!item.projectId && item.projectRaw ? 'border-amber-300 text-amber-700' : 'border-gray-200 text-gray-700'}`}
                          value={item.projectId}
                          onChange={e => {
                            const p = projects.find(p => p.id === e.target.value)
                            updateItem(item.key, { projectId: e.target.value, projectName: p?.name ?? '', matched: !!p })
                          }}>
                          <option value="">{item.projectRaw || '— без проекту —'}</option>
                          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-4 text-right">
                        <input type="number" step="0.01" min="0"
                          className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400"
                          value={item.hoursDecimal}
                          onChange={e => updateItem(item.key, { hoursDecimal: parseFloat(e.target.value) || 0 })} />
                      </td>
                      <td className="py-2 px-4 text-right">
                        <input type="number" step="0.5" min="0"
                          className="w-14 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400"
                          value={item.rate}
                          onChange={e => updateItem(item.key, { rate: parseFloat(e.target.value) || 0 })} />
                      </td>
                      <td className="py-2 px-4 text-right font-semibold text-red-500">${item.amount.toFixed(2)}</td>
                      <td className="py-2 px-2">
                        <button onClick={() => removeItem(item.key)} className="text-gray-300 hover:text-red-400 transition-colors">
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between p-5 border-t border-gray-100 flex-shrink-0">
              <div className="text-sm">
                <span className="text-gray-500">Всього: </span>
                <span className="font-bold text-gray-900">${total.toFixed(2)}</span>
                <span className="text-gray-400 ml-2">({items.length} рядків)</span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep('upload')}
                  className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition-colors">
                  Назад
                </button>
                <button onClick={save} disabled={saving || items.length === 0}
                  className="bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors">
                  {saving ? 'Збереження...' : 'Зберегти чернетку'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Lead Managers Section ─────────────────────────────────────────────────────

function LeadManagersSection({ managers, usdRate, onPay }: {
  managers: LeadManager[]
  usdRate: number
  onPay: (mgr: LeadManager) => void
}) {
  const [open, setOpen] = useState(false)
  const totalUnpaid = managers.reduce((s, m) => s + m.unpaid_usd, 0)

  return (
    <div className="border border-gray-100 rounded-xl mb-6 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Users size={16} className="text-gray-500" />
          <span className="font-semibold text-gray-800 text-sm">Лідогени</span>
          <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded font-medium">
            {managers.length} менеджерів
          </span>
          {totalUnpaid > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">
              Нараховано: ${totalUnpaid.toFixed(2)}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {managers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Менеджерів немає</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left py-3 px-5 text-xs font-medium text-gray-500">Менеджер</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Email</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-gray-500">Нараховано ($)</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-gray-500">≈ UAH</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {managers.map(mgr => (
                  <tr key={mgr.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-5 font-medium text-gray-800">{mgr.name}</td>
                    <td className="py-3 px-4 text-gray-500 text-xs">{mgr.email}</td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-700">
                      ${mgr.unpaid_usd.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-500 text-xs">
                      {usdRate > 0 ? `₴${(mgr.unpaid_usd * usdRate).toFixed(0)}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => onPay(mgr)}
                        disabled={mgr.unpaid_usd === 0}
                        className="flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ml-auto"
                      >
                        <CheckCircle size={12} /> Виплатити
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Lead Manager Pay Modal ────────────────────────────────────────────────────

function LeadManagerPayModal({ manager, accounts, usdRate, onClose, onSuccess }: {
  manager: LeadManager
  accounts: Account[]
  usdRate: number
  onClose: () => void
  onSuccess: () => void
}) {
  const recommended = usdRate > 0 ? Math.round(manager.unpaid_usd * usdRate * 100) / 100 : 0
  const [accountId, setAccountId]   = useState(accounts[0]?.id ?? '')
  const [uahAmount, setUahAmount]   = useState(recommended.toFixed(2))
  const [saving, setSaving]         = useState(false)

  async function pay() {
    if (!accountId || !parseFloat(uahAmount)) return
    setSaving(true)
    const amount = parseFloat(uahAmount)

    // 1. Create expense transaction
    const { data: tx } = await supabase.from('transactions').insert({
      type: 'expense',
      amount,
      currency: 'UAH',
      account_id: accountId,
      date: new Date().toISOString(),
      comment: `Зарплата лідогена: ${manager.name} ($${manager.unpaid_usd.toFixed(2)})`,
    }).select('id').single()

    // 2. Deduct from account balance
    await supabase.rpc('update_account_balance', { p_account_id: accountId, p_delta: -amount })

    // 3. Mark all unpaid leads of this manager as paid
    await supabase.from('leads')
      .update({ is_earnings_paid: true })
      .eq('manager_id', manager.id)
      .eq('is_earnings_paid', false)

    setSaving(false)
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Виплата лідогену</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="bg-gray-50 rounded-xl px-4 py-3 flex justify-between items-center">
            <div>
              <p className="text-xs text-gray-500">Менеджер</p>
              <p className="font-semibold text-gray-800">{manager.name}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Нараховано</p>
              <p className="font-bold text-gray-900 text-lg">${manager.unpaid_usd.toFixed(2)}</p>
            </div>
          </div>

          {usdRate > 0 && (
            <p className="text-xs text-gray-500 text-center">
              Курс НБУ: 1 USD = ₴{usdRate.toFixed(2)} &nbsp;·&nbsp; Рекомендована сума: ₴{recommended.toFixed(2)}
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Рахунок списання</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Сума виплати (UAH)</label>
            <input
              type="number" step="0.01" min="0"
              value={uahAmount}
              onChange={e => setUahAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose}
            className="border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition-colors">
            Скасувати
          </button>
          <button onClick={pay} disabled={saving || !accountId || !parseFloat(uahAmount)}
            className="bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors">
            {saving ? 'Виплата...' : 'Підтвердити виплату'}
          </button>
        </div>
      </div>
    </div>
  )
}
