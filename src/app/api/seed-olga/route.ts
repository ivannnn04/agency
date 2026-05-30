import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// One-time seeder: creates Olga's projects + planned salary expenses
// Visit /api/seed-olga once, then it's idempotent (safe to re-run)

const PROJECTS = [
  { name: 'Siji-labs',        ms: 98712369 },
  { name: 'solar-energy-app', ms: 48424961 },
  { name: 'EdTech',           ms: 28308358 },
  { name: 'CarePay',          ms: 6846420  },
  { name: 'Internal (PMO)',   ms: 14151124 },
]

const RATE_USD   = 7
const PAY_DATE   = '2026-06-01T10:00:00+03:00'
const MARKER     = 'ЗП Ольга Липецька — травень 2026'

function msToLabel(ms: number) {
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Guard against double-run
  const { data: existing } = await supabase
    .from('transactions')
    .select('id')
    .ilike('comment', `%${MARKER}%`)
    .limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ ok: false, message: 'Already seeded. Delete the existing transactions first to re-run.' })
  }

  // 1. Upsert projects
  const projectIds: Record<string, string> = {}
  for (const p of PROJECTS) {
    const { data: found } = await supabase
      .from('projects').select('id').eq('name', p.name).maybeSingle()
    if (found) {
      projectIds[p.name] = found.id
    } else {
      const { data: created, error } = await supabase
        .from('projects').insert({ name: p.name, status: 'active' }).select('id').single()
      if (error) return NextResponse.json({ ok: false, error: `Project insert failed: ${error.message}` }, { status: 500 })
      projectIds[p.name] = created.id
    }
  }

  // 2. Get first account
  const { data: accounts, error: accErr } = await supabase
    .from('accounts').select('id, name').limit(1)
  if (accErr || !accounts?.length) {
    return NextResponse.json({ ok: false, error: 'No accounts found — add at least one account in the app first.' }, { status: 400 })
  }
  const accountId = accounts[0].id

  // 3. Get "Зарплата" expense category
  const { data: cats } = await supabase
    .from('categories').select('id').eq('name', 'Зарплата').eq('type', 'expense').maybeSingle()
  const categoryId = cats?.id ?? null

  // 4. Insert planned expense per project
  const rows = PROJECTS.map(p => {
    const amount = Math.round((p.ms / 3600000) * RATE_USD * 100) / 100
    return {
      type:        'expense',
      amount,
      currency:    'USD',
      account_id:  accountId,
      category_id: categoryId,
      project_id:  projectIds[p.name],
      date:        PAY_DATE,
      comment:     `${MARKER}, ${msToLabel(p.ms)} × $${RATE_USD}`,
      is_planned:  true,
    }
  })

  const { error: txErr } = await supabase.from('transactions').insert(rows)
  if (txErr) {
    return NextResponse.json({ ok: false, error: txErr.message }, { status: 500 })
  }

  const total = rows.reduce((s, r) => s + r.amount, 0).toFixed(2)

  return NextResponse.json({
    ok: true,
    projects_created: PROJECTS.map(p => ({
      name:   p.name,
      amount: `$${Math.round((p.ms / 3600000) * RATE_USD * 100) / 100}`,
      time:   msToLabel(p.ms),
    })),
    total_usd: `$${total}`,
    account_used: accounts[0].name,
    date: PAY_DATE,
  })
}
