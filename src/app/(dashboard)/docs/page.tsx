'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  FileText, Plus, Trash2, ChevronRight, ChevronDown, Search, Loader2, Check,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, Code,
  Link2, Minus, Heading1, Heading2, Heading3, CheckSquare,
} from 'lucide-react'

// ClickUp-style docs: a tree of documents on the left, a rich-text editor
// (contentEditable) on the right. Content is HTML, autosaved with a debounce.

interface Doc {
  id: string
  title: string
  content: string
  parent_id: string | null
  sort: number
  updated_at: string
}

export default function DocsPage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  const editorRef = useRef<HTMLDivElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeDoc = docs.find(d => d.id === activeId) ?? null

  useEffect(() => { load() }, [])

  async function load() {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true })
    setLoading(false)
    if (error) { setDbError('Запусти міграцію documents_migration.sql'); return }
    setDocs((data ?? []) as Doc[])
    if (data && data.length > 0 && !activeId) setActiveId(data[0].id)
  }

  async function createDoc(parentId: string | null = null) {
    const { data, error } = await supabase
      .from('documents')
      .insert({ title: 'Без назви', content: '', parent_id: parentId })
      .select()
      .single()
    if (error) { setDbError('Запусти міграцію documents_migration.sql'); return }
    setDocs(prev => [...prev, data as Doc])
    setActiveId(data.id)
    if (parentId) setCollapsed(prev => { const n = new Set(prev); n.delete(parentId); return n })
  }

  async function deleteDoc(d: Doc) {
    const kids = docs.filter(x => x.parent_id === d.id).length
    if (!window.confirm(`Видалити «${d.title}»${kids > 0 ? ` і ${kids} вкладені сторінки` : ''}?`)) return
    setDocs(prev => prev.filter(x => x.id !== d.id && x.parent_id !== d.id))
    if (activeId === d.id) setActiveId(null)
    await supabase.from('documents').delete().eq('id', d.id)
    load()
  }

  // Debounced autosave of title + content
  const scheduleSave = useCallback((id: string, patch: Partial<Doc>) => {
    setDocs(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      const { error } = await supabase
        .from('documents')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      setSaving(false)
      if (!error) {
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1200)
      }
    }, 700)
  }, [])

  function onEditorInput() {
    if (!activeId || !editorRef.current) return
    scheduleSave(activeId, { content: editorRef.current.innerHTML })
  }

  // Checkboxes inside contentEditable: persist the toggle into the HTML
  function onEditorClick(e: React.MouseEvent) {
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement && t.type === 'checkbox') {
      if (t.hasAttribute('checked')) t.removeAttribute('checked')
      else t.setAttribute('checked', 'checked')
      onEditorInput()
    }
  }

  function exec(command: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    onEditorInput()
  }

  function insertLink() {
    const url = window.prompt('Посилання (https://...)')
    if (url) exec('createLink', url)
  }

  function insertChecklist() {
    exec('insertHTML', '<div class="doc-check"><input type="checkbox"> Пункт</div>')
  }

  // ── Tree helpers ──
  const roots = docs.filter(d => !d.parent_id)
  const childrenOf = (id: string) => docs.filter(d => d.parent_id === id)
  const matches = (d: Doc) => !query.trim() || d.title.toLowerCase().includes(query.toLowerCase())
  const visibleInSearch = (d: Doc): boolean => matches(d) || childrenOf(d.id).some(visibleInSearch)

  function TreeRow({ d, depth }: { d: Doc; depth: number }) {
    const kids = childrenOf(d.id).filter(visibleInSearch)
    const isCollapsed = collapsed.has(d.id) && !query.trim()
    return (
      <div>
        <div
          className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors cursor-pointer ${
            activeId === d.id ? 'bg-gray-100' : 'hover:bg-gray-50'
          }`}
          style={{ paddingLeft: depth * 14 + 4 }}
          onClick={() => setActiveId(d.id)}
        >
          <button
            onClick={e => {
              e.stopPropagation()
              setCollapsed(prev => {
                const n = new Set(prev)
                if (n.has(d.id)) n.delete(d.id); else n.add(d.id)
                return n
              })
            }}
            className={`p-0.5 text-gray-300 hover:text-gray-500 flex-shrink-0 ${kids.length === 0 ? 'invisible' : ''}`}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <FileText size={13} className="text-gray-400 flex-shrink-0" />
          <span className={`flex-1 truncate text-sm py-1.5 ${activeId === d.id ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>
            {d.title || 'Без назви'}
          </span>
          <button
            onClick={e => { e.stopPropagation(); createDoc(d.id) }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-gray-600 flex-shrink-0"
            title="Додати вкладену сторінку"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); deleteDoc(d) }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-400 flex-shrink-0"
            title="Видалити"
          >
            <Trash2 size={12} />
          </button>
        </div>
        {!isCollapsed && kids.map(k => <TreeRow key={k.id} d={k} depth={depth + 1} />)}
      </div>
    )
  }

  const toolbarBtn = 'p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors'

  return (
    <div className="flex h-full">
      {/* Doc tree */}
      <aside className="w-72 border-r border-gray-100 flex flex-col flex-shrink-0 bg-white">
        <div className="p-3 border-b border-gray-100 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
            <Search size={13} className="text-gray-300 flex-shrink-0" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Пошук..."
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
          <button
            onClick={() => createDoc(null)}
            className="bg-gray-900 hover:bg-gray-700 text-white p-2 rounded-lg transition-colors flex-shrink-0"
            title="Новий документ"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="text-xs text-gray-300 p-3">Завантаження...</p>
          ) : roots.filter(visibleInSearch).length === 0 ? (
            <p className="text-xs text-gray-300 p-3">
              {query ? 'Нічого не знайдено' : 'Ще немає документів — створи перший'}
            </p>
          ) : (
            roots.filter(visibleInSearch).map(d => <TreeRow key={d.id} d={d} depth={0} />)
          )}
        </div>
      </aside>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {dbError && (
          <div className="m-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl px-4 py-3">{dbError}</div>
        )}
        {!activeDoc ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-300">
            <FileText size={40} className="opacity-40" />
            <p className="text-sm">Обери документ або створи новий</p>
            <button
              onClick={() => createDoc(null)}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              <Plus size={14} /> Новий документ
            </button>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-0.5 px-6 py-2 border-b border-gray-100 flex-wrap flex-shrink-0">
              <button className={toolbarBtn} onClick={() => exec('formatBlock', '<h1>')} title="Заголовок 1"><Heading1 size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('formatBlock', '<h2>')} title="Заголовок 2"><Heading2 size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('formatBlock', '<h3>')} title="Заголовок 3"><Heading3 size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('formatBlock', '<p>')} title="Звичайний текст"><span className="text-xs font-semibold">Aa</span></button>
              <span className="w-px h-5 bg-gray-100 mx-1" />
              <button className={toolbarBtn} onClick={() => exec('bold')} title="Жирний (Cmd+B)"><Bold size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('italic')} title="Курсив (Cmd+I)"><Italic size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('underline')} title="Підкреслений (Cmd+U)"><Underline size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('strikeThrough')} title="Закреслений"><Strikethrough size={15} /></button>
              <span className="w-px h-5 bg-gray-100 mx-1" />
              <button className={toolbarBtn} onClick={() => exec('insertUnorderedList')} title="Маркований список"><List size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('insertOrderedList')} title="Нумерований список"><ListOrdered size={15} /></button>
              <button className={toolbarBtn} onClick={insertChecklist} title="Чекліст"><CheckSquare size={15} /></button>
              <span className="w-px h-5 bg-gray-100 mx-1" />
              <button className={toolbarBtn} onClick={() => exec('formatBlock', '<blockquote>')} title="Цитата"><Quote size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('formatBlock', '<pre>')} title="Код"><Code size={15} /></button>
              <button className={toolbarBtn} onClick={insertLink} title="Посилання"><Link2 size={15} /></button>
              <button className={toolbarBtn} onClick={() => exec('insertHorizontalRule')} title="Розділювач"><Minus size={15} /></button>
              <span className="ml-auto text-[11px] text-gray-300 flex items-center gap-1">
                {saving ? <><Loader2 size={11} className="animate-spin" /> зберігаємо...</>
                  : savedFlash ? <><Check size={11} className="text-teal-600" /> збережено</>
                  : `оновлено ${new Date(activeDoc.updated_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
              </span>
            </div>

            {/* Title + content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-8 py-8">
                <input
                  value={activeDoc.title}
                  onChange={e => scheduleSave(activeDoc.id, { title: e.target.value })}
                  placeholder="Без назви"
                  className="w-full text-3xl font-bold text-gray-900 placeholder-gray-200 focus:outline-none mb-4 bg-transparent"
                />
                <div
                  key={activeDoc.id}
                  ref={el => {
                    editorRef.current = el
                    if (el && el.dataset.init !== activeDoc.id) {
                      el.innerHTML = activeDoc.content || '<p><br></p>'
                      el.dataset.init = activeDoc.id
                    }
                  }}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={onEditorInput}
                  onClick={onEditorClick}
                  className="doc-editor min-h-[55vh] focus:outline-none text-[15px] leading-relaxed text-gray-800"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
