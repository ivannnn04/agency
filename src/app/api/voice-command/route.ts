import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import supabaseAdmin from '@/lib/supabaseAdmin'
import { suggestEstimate } from '@/lib/preEstimate'

// Voice control for the admin: a spoken command (already transcribed in the
// browser) is parsed by Claude into one structured action; the client shows
// a confirmation and posts the action back here to execute. Admin-only —
// the NextAuth middleware guards this route.

type Action =
  | { kind: 'add_transaction'; type: 'income' | 'expense'; amount: number; currency: string; account_id: string; project_id: string | null; comment: string }
  | { kind: 'add_task'; title: string; project_id: string; assignee_id: string | null }
  | { kind: 'create_project'; name: string }
  | { kind: 'add_lead'; name: string; channel: string | null; amount: number | null }

const CUR = ['USD', 'EUR', 'UAH']

async function loadContext() {
  const [accounts, projects, members] = await Promise.all([
    supabaseAdmin.from('accounts').select('id, name, currency'),
    supabaseAdmin.from('projects').select('id, name').neq('status', 'archived'),
    supabaseAdmin.from('team_members').select('id, name'),
  ])
  return {
    accounts: accounts.data ?? [],
    projects: projects.data ?? [],
    members: members.data ?? [],
  }
}

function summarize(a: Action, ctx: Awaited<ReturnType<typeof loadContext>>): string {
  const acc = (id: string) => ctx.accounts.find(x => x.id === id)?.name ?? '?'
  const proj = (id: string | null) => (id ? ctx.projects.find(x => x.id === id)?.name ?? '?' : null)
  switch (a.kind) {
    case 'add_transaction': {
      const p = proj(a.project_id)
      return `${a.type === 'income' ? 'Додати дохід' : 'Додати витрату'} ${a.amount} ${a.currency} · рахунок «${acc(a.account_id)}»${p ? ` · проєкт «${p}»` : ''}${a.comment ? ` · «${a.comment}»` : ''}`
    }
    case 'add_task': {
      const m = a.assignee_id ? ctx.members.find(x => x.id === a.assignee_id)?.name : null
      return `Створити задачу «${a.title}» у проєкті «${proj(a.project_id)}»${m ? ` для ${m}` : ''}`
    }
    case 'create_project':
      return `Створити проєкт «${a.name}»`
    case 'add_lead':
      return `Додати лід «${a.name}»${a.channel ? ` (${a.channel})` : ''}${a.amount ? ` · $${a.amount}` : ''} на дошку`
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 })

  const ctx = await loadContext()

  // ── Execute a confirmed action ──
  if (body.action) {
    const a = body.action as Action
    try {
      if (a.kind === 'add_transaction') {
        if (!a.account_id || !(a.amount > 0) || !CUR.includes(a.currency)) throw new Error('Некоректна транзакція')
        const { data: cats } = await supabaseAdmin
          .from('categories').select('id').eq('type', a.type).ilike('name', a.type === 'income' ? '%дохід%' : '%інше%').limit(1)
        await supabaseAdmin.from('transactions').insert({
          type: a.type,
          amount: a.amount,
          currency: a.currency,
          account_id: a.account_id,
          category_id: cats?.[0]?.id ?? null,
          project_id: a.project_id,
          date: new Date().toISOString(),
          comment: a.comment || 'Голосова команда',
          is_planned: false,
        })
        await supabaseAdmin.rpc('update_account_balance', {
          p_account_id: a.account_id,
          p_delta: a.type === 'income' ? a.amount : -a.amount,
        })
      } else if (a.kind === 'add_task') {
        const { data: cols } = await supabaseAdmin
          .from('pm_columns').select('id').eq('project_id', a.project_id).order('position').limit(1)
        if (!cols?.[0]) throw new Error('У проєкту немає колонок на дошці')
        const base = {
          title: a.title,
          finance_project_id: a.project_id,
          column_id: cols[0].id,
          team_member_id: a.assignee_id,
          status: 'todo',
          priority: 'medium',
        }
        let { error } = await supabaseAdmin.from('pm_tasks').insert({ ...base, estimate_hours: suggestEstimate(a.title) })
        if (error && error.message.includes('estimate_hours')) {
          ;({ error } = await supabaseAdmin.from('pm_tasks').insert(base))
        }
        if (error) throw new Error(error.message)
        if (a.assignee_id) {
          await supabaseAdmin.from('notifications').insert({
            type: 'task_created',
            message: `Ivan створив задачу «${a.title}» (голосом)`,
            project_id: a.project_id,
            team_member_id: a.assignee_id,
            recipient_team_member_id: a.assignee_id,
          })
        }
      } else if (a.kind === 'create_project') {
        if (!a.name?.trim()) throw new Error('Порожня назва проєкту')
        await supabaseAdmin.from('projects').insert({ name: a.name.trim(), status: 'active' })
      } else if (a.kind === 'add_lead') {
        if (!a.name?.trim()) throw new Error('Порожнє імʼя ліда')
        await supabaseAdmin.from('crm_leads').insert({
          name: a.name.trim(),
          channel: a.channel,
          amount: a.amount,
          status: 'new',
        })
      } else {
        throw new Error('Невідома дія')
      }
      return NextResponse.json({ ok: true, done: summarize(a, ctx) })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  // ── Parse a transcript into an action ──
  const transcript = String(body.transcript ?? '').trim()
  if (!transcript) return NextResponse.json({ error: 'transcript required' }, { status: 400 })
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Додай ANTHROPIC_API_KEY у Vercel, щоб голосові команди запрацювали' }, { status: 500 })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const system = `Ти — парсер голосових команд адмінки агенції Gudrix. Команди українською. Поточна дата: ${new Date().toISOString().slice(0, 10)}.
Обери ОДИН інструмент, що відповідає команді. Підбирай id зі списків нижче за змістом (нечітке співпадіння назв — нормально). Якщо рахунок не назвали — обери найдоречніший за валютою. Суми: "п'ятсот доларів" = 500 USD, "дві тисячі гривень" = 2000 UAH.

РАХУНКИ: ${ctx.accounts.map(a => `${a.id}=${a.name}(${a.currency})`).join('; ')}
ПРОЄКТИ: ${ctx.projects.map(p => `${p.id}=${p.name}`).join('; ')}
КОМАНДА: ${ctx.members.map(m => `${m.id}=${m.name}`).join('; ')}`

  const idEnum = (xs: { id: string }[]) => xs.map(x => x.id)
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    system,
    tool_choice: { type: 'any' },
    tools: [
      {
        name: 'add_transaction',
        description: 'Додати дохід або витрату',
        input_schema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['income', 'expense'] },
            amount: { type: 'number' },
            currency: { type: 'string', enum: CUR },
            account_id: { type: 'string', enum: idEnum(ctx.accounts) },
            project_id: { type: ['string', 'null'], enum: [...idEnum(ctx.projects), null] },
            comment: { type: 'string', description: 'Короткий коментар із команди' },
          },
          required: ['type', 'amount', 'currency', 'account_id', 'comment'],
        },
      },
      {
        name: 'add_task',
        description: 'Створити задачу у проєкті',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            project_id: { type: 'string', enum: idEnum(ctx.projects) },
            assignee_id: { type: ['string', 'null'], enum: [...idEnum(ctx.members), null] },
          },
          required: ['title', 'project_id'],
        },
      },
      {
        name: 'create_project',
        description: 'Створити новий проєкт',
        input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      {
        name: 'add_lead',
        description: 'Додати лід на CRM-дошку',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            channel: { type: ['string', 'null'] },
            amount: { type: ['number', 'null'] },
          },
          required: ['name'],
        },
      },
      {
        name: 'unknown',
        description: 'Команда не підходить під жоден інструмент або незрозуміла',
        input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
      },
    ],
    messages: [{ role: 'user', content: transcript }],
  })

  const tu = msg.content.find(b => b.type === 'tool_use')
  if (!tu || tu.type !== 'tool_use' || tu.name === 'unknown') {
    const reason = tu && tu.type === 'tool_use' ? (tu.input as { reason?: string }).reason : null
    return NextResponse.json({ unknown: true, reason: reason ?? 'Не зрозумів команду — спробуй ще раз' })
  }

  const action = { kind: tu.name, ...(tu.input as object) } as Action
  return NextResponse.json({ action, summary: summarize(action, ctx) })
}
