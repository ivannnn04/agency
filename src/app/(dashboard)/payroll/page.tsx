'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
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
  projects?: { name: string } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTime(raw: string): number {
  if (!raw) return 0
  const s = String(raw).trim()
  if (/^\d{6,}$/.test(s)) return Number(s) / 3600000
  const hms = s.match(/^(\d+):(\d+):(\d+)$/)
  if (hms) return Number(hms[1]) + Number(hms[2]) / 60 + Number(hms[3]) / 3600
  const hm = s.match(/^(\d+):(\d+)$/)
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60
  const hm2 = s.match(/(\d+)h(?:\s+(\d+)m)?/)
  if (hm2) return Number(hm2[1]) + (Number(hm2[2] ?? 0) / 60)
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        if (rows.length < 2) { resolve([]); return }

        const headers = rows[0].map(h => String(h).toLowerCase().trim())
        const findCol = (...names: string[]) => {
          for (const n of names) {
            const i = headers.findIndex(h => h.includes(n))
            if (i >= 0) return i
          }
          return -1
        }

        const empCol  = findCol('user', 'assignee', 'employee', 'name', 'виконавець', "ім'я")
        const projCol = findCol('task', 'project', 'проект', 'завдання')
        const timeCol = findCol('logged', 'time', 'duration', 'tracked', 'час', 'тривалість')
        const rateCol = findCol('rate', 'ставка')

        if (empCol < 0 || timeCol < 0) {
          reject(new Error(`Не вдалося знайти колонки. Заголовки: ${rows[0].join(', ')}`))
          return
        }

        const items: PayrollItem[] = []
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

          const amount = Math.round(hours * rate * 100) / 100

          items.push({
            key: `${i}-${employee}-${projectRaw}`,
            employee, projectRaw,
            projectId:   matched?.id   ?? '',
            projectName: matched?.name ?? '',
            hoursDecimal: Math.round(hours * 100) / 100,
            rate, amount,
            matched: !!matched,
            isManual: false,
          })
        }
        resolve(items)
      } catch (err: any) {
        reject(new Error('Помилка парсингу файлу: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Помилка читання файлу'))
    reader.readAsArrayBuffer(file)
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

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: r }, { data: a }, { data: p }, { data: e }, { data: pr }] = await Promise.all([
      supabase.from('payroll_runs')
        .select('*, payroll_items(*, projects(name)), accounts(name)')
        .order('created_at', { ascending: false }),
      supabase.from('accounts').select('id,name,currency').order('created_at'),
      supabase.from('projects').select('id,name').neq('status', 'archived').order('name'),
      supabase.from('employees').select('*').order('name'),
      supabase.from('employee_project_rates').select('*, projects(name)'),
    ])
    if (r)  setRuns(r as PayrollRun[])
    if (a)  setAccounts(a)
    if (p)  setProjects(p)
    if (e)  setEmployees(e)
    if (pr) setProjectRates(pr as EmployeeProjectRate[])
    setLoading(false)
  }

  async function payRun(run: PayrollRun) {
    if (!run.account_id) { alert('Оберіть рахунок для списання'); return }
    const items = run.payroll_items ?? []
    for (const item of items) {
      const commentParts = [`ЗП ${item.employee_name} — ${run.label}`]
      if (item.hours_decimal > 0) commentParts.push(`${item.hours_decimal}h × $${item.rate_usd}`)
      const { data: tx } = await supabase.from('transactions').insert({
        type: 'expense', amount: item.amount, currency: run.currency,
        account_id: run.account_id, project_id: item.project_id,
        date: new Date().toISOString(),
        comment: commentParts.join(', '),
        is_planned: false,
      }).select('id').single()
      await supabase.rpc('update_account_balance', { p_account_id: run.account_id, p_delta: -item.amount })
      if (tx) await supabase.from('payroll_items').update({ transaction_id: tx.id }).eq('id', item.id)
    }
    await supabase.from('payroll_runs').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', run.id)
    fetchAll()
  }

  async function deleteRun(id: string) {
    await supabase.from('payroll_runs').delete().eq('id', id)
    fetchAll()
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
                    onPay={() => payRun(run)} onDelete={() => deleteRun(run.id)} />
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
                    onPay={() => {}} onDelete={() => deleteRun(run.id)} />
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

function RunCard({ run, expanded, onToggle, onPay, onDelete }: {
  run: PayrollRun; expanded: boolean
  onToggle: () => void; onPay: () => void; onDelete: () => void
}) {
  const isDraft = run.status === 'draft'
  const items   = run.payroll_items ?? []

  const byProject: Record<string, { name: string; items: PayrollItemRow[]; total: number }> = {}
  for (const item of items) {
    const key   = item.project_id ?? '__none__'
    const pName = item.projects?.name ?? item.project_name_raw ?? '—'
    if (!byProject[key]) byProject[key] = { name: pName, items: [], total: 0 }
    byProject[key].items.push(item)
    byProject[key].total += item.amount
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${isDraft ? 'border-amber-200' : 'border-gray-200'}`}>
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
          {isDraft && (
            <button onClick={e => { e.stopPropagation(); onPay() }}
              className="bg-teal-500 hover:bg-teal-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors">
              Оплатити
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="text-gray-300 hover:text-red-400 transition-colors p-1">
            <X size={14} />
          </button>
        </div>
      </div>

      {expanded && (
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
                        <td className="py-2 px-3 text-right font-semibold text-red-500">${item.amount.toFixed(2)}</td>
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
  )
}

// ── Manual Payroll Modal ───────────────────────────────────────────────────────

interface ManualEntry { id: string; employee: string; projectId: string; amount: string }

function ManualPayrollModal({ employees, projects, accounts, onClose, onSuccess }: {
  employees: Employee[]; projects: Project[]; accounts: Account[]
  onClose: () => void; onSuccess: () => void
}) {
  const defaultLabel = `ЗП ${new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' }).format(new Date())}`
  const [label, setLabel]         = useState(defaultLabel)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [entries, setEntries]     = useState<ManualEntry[]>([{ id: '1', employee: '', projectId: '', amount: '' }])
  const [saving, setSaving]       = useState(false)

  function addRow() {
    setEntries(prev => [...prev, { id: String(Date.now()), employee: '', projectId: '', amount: '' }])
  }

  function updateRow(id: string, patch: Partial<ManualEntry>) {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  function removeRow(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  async function save() {
    const valid = entries.filter(e => e.employee.trim() && parseFloat(e.amount) > 0)
    if (valid.length === 0) return
    setSaving(true)

    const total = valid.reduce((s, e) => s + parseFloat(e.amount), 0)
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
        hours_decimal: 0,
        rate_usd: 0,
        amount: parseFloat(e.amount),
      }))
    )
    onSuccess()
  }

  const total = entries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
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
                <th className="text-right pb-2 font-medium w-28">Сума ($)</th>
                <th className="w-6 pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(entry => (
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
                    <input type="number" step="0.01" min="0" placeholder="0.00"
                      value={entry.amount}
                      onChange={e => updateRow(entry.id, { amount: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  </td>
                  <td className="py-2 text-center">
                    {entries.length > 1 && (
                      <button onClick={() => removeRow(entry.id)} className="text-gray-300 hover:text-red-400 transition-colors p-1">
                        <X size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
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
