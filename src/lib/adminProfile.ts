'use client'

import { supabase } from '@/lib/supabase'

// The admin's display profile (photo, name, status). Login is Google via
// NextAuth — this only controls how the admin appears inside the app.
// Cached per page load; clear the cache after saving changes.

export interface AdminProfile {
  name: string
  avatar_url: string | null
  status_emoji: string | null
  status_text: string | null
}

const DEFAULT: AdminProfile = { name: 'Ivan', avatar_url: null, status_emoji: null, status_text: null }

let cache: AdminProfile | null = null

export async function getAdminProfile(): Promise<AdminProfile> {
  if (cache) return cache
  const { data } = await supabase
    .from('admin_profile')
    .select('name, avatar_url, status_emoji, status_text')
    .eq('id', 'main')
    .maybeSingle()
  cache = {
    name: (data?.name as string) || DEFAULT.name,
    avatar_url: (data?.avatar_url as string | null) ?? null,
    status_emoji: (data?.status_emoji as string | null) ?? null,
    status_text: (data?.status_text as string | null) ?? null,
  }
  return cache
}

export function clearAdminProfileCache() {
  cache = null
}
