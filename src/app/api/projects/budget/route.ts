import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminAuth'
import { addEstimateToBudget, addItem, deleteItem, getBudget, setBase, updateItem } from '@/lib/projectBudget'

// Project budget: read the ledger, change the starting amount, add or edit
// later additions, change the currency. Admin-only.

const CURRENCIES = ['USD', 'EUR', 'UAH']
const amountOf = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null }

export async function GET(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const projectId = req.nextUrl.searchParams.get('project') ?? ''
  if (!projectId) return NextResponse.json({ error: 'project is required' }, { status: 400 })
  return NextResponse.json(await getBudget(projectId))
}

// Add a line: a manual addition, or the price of an approved task estimate
export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })

  if (typeof body.taskId === 'string') {
    const r = await addEstimateToBudget(body.taskId)
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json(await getBudget(projectId))
  }
  const title = String(body.title ?? '').trim()
  const amount = amountOf(body.amount)
  if (!title || amount === null || amount === 0) return NextResponse.json({ error: 'Вкажи назву і суму' }, { status: 400 })
  const r = await addItem(projectId, { title, amount })
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(await getBudget(projectId))
}

export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })

  if (typeof body.currency === 'string') {
    if (!CURRENCIES.includes(body.currency)) return NextResponse.json({ error: 'Невідома валюта' }, { status: 400 })
    const { error } = await supabaseAdmin.from('projects').update({ contract_currency: body.currency }).eq('id', projectId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (typeof body.id === 'string') {
    const amount = body.amount === undefined ? undefined : amountOf(body.amount)
    if (amount === null) return NextResponse.json({ error: 'Некоректна сума' }, { status: 400 })
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : undefined
    // "base" is the starting budget, whether or not the ledger exists yet
    const { items } = await getBudget(projectId)
    const target = items.find(i => i.id === body.id)
    const r = body.id === 'base' || target?.kind === 'base'
      ? (amount === undefined ? {} : await setBase(projectId, Math.max(0, amount)))
      : await updateItem(projectId, body.id, { ...(title ? { title } : {}), ...(amount !== undefined ? { amount } : {}) })
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 })
  }
  return NextResponse.json(await getBudget(projectId))
}

export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const projectId = req.nextUrl.searchParams.get('project') ?? ''
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!projectId || !id) return NextResponse.json({ error: 'project and id are required' }, { status: 400 })
  const r = await deleteItem(projectId, id)
  if (r.error) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(await getBudget(projectId))
}
