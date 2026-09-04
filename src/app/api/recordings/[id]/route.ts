import { NextRequest, NextResponse } from 'next/server'
import supabaseAdmin from '@/lib/supabaseAdmin'

// Public: anyone with the /r/<id> link can load the recording metadata.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('screen_recordings')
    .select('id, title, file_url, duration_seconds, created_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(data)
}
