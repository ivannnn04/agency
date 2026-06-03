import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decode } from 'next-auth/jwt'
import Anthropic from '@anthropic-ai/sdk'

async function requireAdmin() {
  const jar = await cookies()
  const sessionToken =
    jar.get('__Secure-next-auth.session-token')?.value ??
    jar.get('next-auth.session-token')?.value
  if (!sessionToken) return false
  const token = await decode({ token: sessionToken, secret: process.env.NEXTAUTH_SECRET! })
  return token?.role === 'admin'
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { tasks } = await req.json()
  if (!tasks || !Array.isArray(tasks)) {
    return NextResponse.json({ error: 'Missing tasks' }, { status: 400 })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const taskSummary = tasks.map((t: {
    title: string
    bucket: string
    time_spent_sec?: number
    estimated_min?: number
    completed_at?: string
    created_at: string
  }) => {
    const spent = t.time_spent_sec ? Math.round(t.time_spent_sec / 60) : 0
    const est = t.estimated_min ?? 0
    return `- [${t.bucket}] "${t.title}" | оцінка: ${est}хв | витрачено: ${spent}хв | завершено: ${t.completed_at ? 'так' : 'ні'}`
  }).join('\n')

  const prompt = `Ти — AI-коуч з продуктивності для CEO. Проаналізуй список задач нижче і дай конкретний, персональний звіт українською мовою.

Задачі:
${taskSummary}

Структуруй відповідь так:
1. **Загальна ефективність** — коротко оціни продуктивність (рейтинг 1-10 і чому)
2. **Точність планування** — наскільки добре оцінюються задачі (оцінка vs реальність)
3. **Патерни** — що ти бачиш у виборі задач, пріоритетах, затримках
4. **Топ-3 рекомендації** — конкретні GTD-поради для покращення ефективності CEO
5. **Фокус на завтра** — 1-2 речення що варто зробити першочергово

Будь прямим і конкретним. Без води.`

  const message = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  return NextResponse.json({ analysis: text })
}
