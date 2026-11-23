'use client'

import { useEffect, useRef, useState } from 'react'
import * as tus from 'tus-js-client'
import { supabase } from '@/lib/supabase'
import { safeStoragePath } from '@/components/chat/shared'
import { Download, File as FileIcon, FileSpreadsheet, FileText, Film, Image as ImageIcon, Loader2, Paperclip, Trash2, Upload, X } from 'lucide-react'

// Files on a task: any type, many at once, large ones too. Uploads go to
// Supabase Storage in resumable chunks, so a big file survives a dropped
// connection and shows real progress.

const BUCKET = 'chat-files'
const MAX_BYTES = 5 * 1024 * 1024 * 1024        // 5 GB per file; Supabase's own limit applies first
const CHUNK = 6 * 1024 * 1024                    // required chunk size for Supabase resumable uploads
const PARALLEL = 2

interface TaskFile {
  id: string
  file_name: string
  file_url: string
  storage_path: string | null
  file_size: number | null
  mime_type: string | null
  uploaded_by: string | null
  created_at: string
}
interface Job { key: string; name: string; size: number; sent: number; error?: string; abort?: () => void }

function fmtSize(n: number | null): string {
  if (!n) return ''
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

function iconFor(name: string, mime: string | null) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (mime?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return ImageIcon
  if (mime?.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi'].includes(ext)) return Film
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return FileSpreadsheet
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'pages'].includes(ext)) return FileText
  return FileIcon
}

// One resumable upload; resolves with the public URL
function uploadResumable(file: File, path: string, token: string, onProgress: (sent: number) => void, onAbortable: (abort: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: BUCKET, objectName: path, contentType: file.type || 'application/octet-stream', cacheControl: '3600' },
      chunkSize: CHUNK,
      onError: err => reject(err),
      onProgress: sent => onProgress(sent),
      onSuccess: () => resolve(),
    })
    onAbortable(() => { upload.abort(true).catch(() => {}); reject(new Error('aborted')) })
    upload.findPreviousUploads()
      .then(prev => { if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]); upload.start() })
      .catch(() => upload.start())
  })
}

function explain(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err)
  if (/413|maximum allowed size|exceeded|too large|Payload/i.test(msg)) {
    return 'Файл більший за ліміт у Supabase. Підніми його: Supabase → Storage → Settings → Upload file size limit.'
  }
  if (/task_files|schema cache/i.test(msg)) return 'Запусти міграцію supabase/task_files_migration.sql у Supabase SQL Editor'
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Зʼєднання обірвалось — спробуй ще раз, завантаження продовжиться з того ж місця.'
  return msg.length > 160 ? msg.slice(0, 160) + '…' : msg
}

export default function TaskFiles({ taskId, projectId, uploadedBy }: {
  taskId: string
  projectId: string | null
  uploadedBy: string
}) {
  const [files, setFiles] = useState<TaskFile[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const queue = useRef<{ key: string; file: File }[]>([])
  const running = useRef(0)

  useEffect(() => {
    let alive = true
    supabase.from('task_files').select('*').eq('task_id', taskId).order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (!alive) return
        if (err) { if (!/task_files|schema cache/i.test(err.message)) setError(err.message); return }
        setFiles((data ?? []) as TaskFile[])
      })
    return () => { alive = false }
  }, [taskId])

  const patchJob = (key: string, patch: Partial<Job>) => setJobs(prev => prev.map(j => (j.key === key ? { ...j, ...patch } : j)))

  async function runOne(key: string, file: File) {
    const path = safeStoragePath(projectId ?? 'tasks', `task-${file.name}`)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
      try {
        await uploadResumable(file, path, token, sent => patchJob(key, { sent }), abort => patchJob(key, { abort }))
      } catch (e) {
        if (String((e as Error)?.message) === 'aborted') throw e
        // Smaller files can still go the ordinary way if resumable upload is refused
        if (file.size > 45 * 1024 * 1024) throw e
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
        if (upErr) throw upErr
      }
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const { data: row, error: insErr } = await supabase.from('task_files').insert({
        task_id: taskId, project_id: projectId, file_name: file.name, file_url: pub.publicUrl, storage_path: path,
        file_size: file.size, mime_type: file.type || null, uploaded_by: uploadedBy,
      }).select('*').single()
      if (insErr) throw insErr
      setFiles(prev => [row as TaskFile, ...prev])
      setJobs(prev => prev.filter(j => j.key !== key))
    } catch (e) {
      if (String((e as Error)?.message) === 'aborted') setJobs(prev => prev.filter(j => j.key !== key))
      else patchJob(key, { error: explain(e), abort: undefined })
    }
  }

  function pump() {
    while (running.current < PARALLEL && queue.current.length > 0) {
      const next = queue.current.shift()!
      running.current++
      runOne(next.key, next.file).finally(() => { running.current--; pump() })
    }
  }

  function add(list: FileList | File[] | null) {
    const picked = Array.from(list ?? [])
    if (picked.length === 0) return
    setError('')
    const fresh: Job[] = []
    for (const file of picked) {
      const key = crypto.randomUUID()
      if (file.size > MAX_BYTES) { fresh.push({ key, name: file.name, size: file.size, sent: 0, error: `Завеликий файл — максимум ${fmtSize(MAX_BYTES)}` }); continue }
      fresh.push({ key, name: file.name, size: file.size, sent: 0 })
      queue.current.push({ key, file })
    }
    setJobs(prev => [...prev, ...fresh])
    pump()
  }

  async function remove(f: TaskFile) {
    if (!confirm(`Видалити файл «${f.file_name}»?`)) return
    const { error: delErr } = await supabase.from('task_files').delete().eq('id', f.id)
    if (delErr) { setError(delErr.message); return }
    setFiles(prev => prev.filter(x => x.id !== f.id))
    if (f.storage_path) supabase.storage.from(BUCKET).remove([f.storage_path]).then(() => {}, () => {})
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
          <Paperclip size={12} /> Файли{files.length > 0 ? ` · ${files.length}` : ''}
        </p>
        <button onClick={() => inputRef.current?.click()} className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900">
          <Upload size={12} /> Додати файли
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => { add(e.target.files); e.target.value = '' }} />
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files) }}
        className={`rounded-xl border border-dashed transition-colors ${dragging ? 'border-gray-900 bg-gray-100' : 'border-gray-200'} ${files.length + jobs.length === 0 ? 'px-3 py-5 text-center' : 'p-1.5'}`}
      >
        {files.length + jobs.length === 0 ? (
          <button onClick={() => inputRef.current?.click()} className="text-sm text-gray-400 hover:text-gray-600">
            Перетягни файли сюди або натисни, щоб обрати
            <span className="block text-[11px] text-gray-300 mt-0.5">PDF, Excel, макети, відео — будь-що, кілька одразу</span>
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            {jobs.map(j => (
              <div key={j.key} className="rounded-lg bg-gray-50 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  {j.error ? <X size={13} className="text-red-500 flex-shrink-0" /> : <Loader2 size={13} className="animate-spin text-gray-400 flex-shrink-0" />}
                  <span className="text-sm text-gray-700 truncate flex-1">{j.name}</span>
                  <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">
                    {j.error ? fmtSize(j.size) : `${j.size ? Math.round((j.sent / j.size) * 100) : 0}% · ${fmtSize(j.size)}`}
                  </span>
                  <button
                    onClick={() => { if (j.abort) j.abort(); else setJobs(prev => prev.filter(x => x.key !== j.key)) }}
                    className="text-gray-300 hover:text-red-500 flex-shrink-0" title={j.error ? 'Прибрати' : 'Скасувати'}
                  >
                    <X size={13} />
                  </button>
                </div>
                {j.error ? (
                  <p className="text-[11px] text-red-600 mt-1">{j.error}</p>
                ) : (
                  <div className="h-1 bg-gray-200 rounded-full overflow-hidden mt-1.5">
                    <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${j.size ? (j.sent / j.size) * 100 : 0}%` }} />
                  </div>
                )}
              </div>
            ))}
            {files.map(f => {
              const Icon = iconFor(f.file_name, f.mime_type)
              return (
                <div key={f.id} className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-gray-50">
                  <Icon size={16} className="text-gray-400 flex-shrink-0" />
                  <a href={f.file_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-800 truncate hover:underline">{f.file_name}</span>
                    <span className="block text-[11px] text-gray-400">
                      {[fmtSize(f.file_size), f.uploaded_by, new Date(f.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}
                    </span>
                  </a>
                  <a href={f.file_url} download={f.file_name} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-gray-700 flex-shrink-0" title="Завантажити">
                    <Download size={14} />
                  </a>
                  <button onClick={() => remove(f)} className="text-gray-300 hover:text-red-500 flex-shrink-0" title="Видалити файл">
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-red-600 mt-1.5">{explain(error)}</p>}
    </div>
  )
}
