'use client'

import { useEffect, useRef } from 'react'
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Highlight from '@tiptap/extension-highlight'
import { Placeholder } from '@tiptap/extensions'
import {
  Bold, Code, Heading2, Highlighter, Italic, Link2, List, ListChecks, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2,
} from 'lucide-react'

// The task description with formatting: bold, italic, underline, highlight,
// headings, bullet and numbered lists, quotes, links and checklists whose
// boxes can be ticked. Saved as HTML (description_html) plus a plain-text
// copy (description) for emails, previews and the AI. Content is always
// rendered through the editor's schema, never injected as raw HTML.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// An older plain-text description becomes paragraphs with clickable links
export function plainToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => `<p>${esc(line).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>')}</p>`)
    .join('')
}

export interface DescriptionValue { html: string | null; text: string | null }

// The plain-text copy used by emails, previews and the AI: lists keep their
// bullets and numbers, checklist items show whether they are ticked
interface DocNode { type?: string; text?: string; attrs?: Record<string, unknown>; content?: DocNode[] }
const inline = (n: DocNode): string =>
  n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join('')
function blocks(nodes: DocNode[] = [], indent = ''): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') {
      let i = Number(n.attrs?.start ?? 1)
      for (const item of n.content ?? []) {
        const mark = n.type === 'bulletList' ? '•' : n.type === 'orderedList' ? `${i++}.` : item.attrs?.checked ? '☑' : '☐'
        const [first = '', ...rest] = blocks(item.content, indent + '   ')
        out.push(`${indent}${mark} ${first.trimStart()}`, ...rest)
      }
    } else if (n.type === 'blockquote') {
      out.push(...blocks(n.content, indent).map(l => `${indent}> ${l.trimStart()}`))
    } else if (n.type === 'horizontalRule') {
      out.push(`${indent}———`)
    } else {
      out.push(...inline(n).split('\n').map(l => indent + l))
    }
  }
  return out
}
export const docToPlain = (doc: DocNode) => blocks(doc.content).join('\n').replace(/\n{3,}/g, '\n\n').trim()

const SAVE_AFTER_MS = 800

function ToolButton({ on, title, onClick, children, disabled }: {
  on?: boolean; title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      // Keep the selection in the editor while clicking the toolbar
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-30 ${on ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/70'}`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
      highlight: e.isActive('highlight'), heading: e.isActive('heading', { level: 2 }), bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'), task: e.isActive('taskList'), quote: e.isActive('blockquote'), code: e.isActive('code'),
      link: e.isActive('link'), undo: e.can().undo(), redo: e.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Посилання (порожньо — прибрати)', prev ?? 'https://')
    if (url === null) return
    const clean = url.trim()
    if (!clean || clean === 'https://') { chain().extendMarkRange('link').unsetLink().run(); return }
    const href = /^(https?:|mailto:)/i.test(clean) ? clean : `https://${clean}`
    chain().extendMarkRange('link').setLink({ href }).run()
  }
  const sep = <span className="w-px h-4 bg-gray-200 mx-0.5" />
  return (
    <div className="flex items-center gap-0.5 flex-wrap px-1.5 py-1 border-b border-gray-200/80">
      <ToolButton title="Жирний (Ctrl+B)" on={s.bold} onClick={() => chain().toggleBold().run()}><Bold size={14} /></ToolButton>
      <ToolButton title="Курсив (Ctrl+I)" on={s.italic} onClick={() => chain().toggleItalic().run()}><Italic size={14} /></ToolButton>
      <ToolButton title="Підкреслений (Ctrl+U)" on={s.underline} onClick={() => chain().toggleUnderline().run()}><Underline size={14} /></ToolButton>
      <ToolButton title="Закреслений" on={s.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough size={14} /></ToolButton>
      <ToolButton title="Виділити маркером" on={s.highlight} onClick={() => chain().toggleHighlight().run()}><Highlighter size={14} /></ToolButton>
      {sep}
      <ToolButton title="Заголовок" on={s.heading} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 size={14} /></ToolButton>
      <ToolButton title="Список з булетами" on={s.bullet} onClick={() => chain().toggleBulletList().run()}><List size={14} /></ToolButton>
      <ToolButton title="Нумерований список" on={s.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={14} /></ToolButton>
      <ToolButton title="Чекліст з галочками" on={s.task} onClick={() => chain().toggleTaskList().run()}><ListChecks size={14} /></ToolButton>
      {sep}
      <ToolButton title="Цитата" on={s.quote} onClick={() => chain().toggleBlockquote().run()}><Quote size={14} /></ToolButton>
      <ToolButton title="Код" on={s.code} onClick={() => chain().toggleCode().run()}><Code size={14} /></ToolButton>
      <ToolButton title="Посилання" on={s.link} onClick={setLink}><Link2 size={14} /></ToolButton>
      <span className="flex-1" />
      <ToolButton title="Скасувати (Ctrl+Z)" disabled={!s.undo} onClick={() => chain().undo().run()}><Undo2 size={14} /></ToolButton>
      <ToolButton title="Повторити" disabled={!s.redo} onClick={() => chain().redo().run()}><Redo2 size={14} /></ToolButton>
    </div>
  )
}

export default function RichDescription({ html, text, placeholder, onSave }: {
  html: string | null | undefined
  text: string | null | undefined
  placeholder: string
  onSave: (value: DescriptionValue) => void
}) {
  const saved = useRef<string>('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(onSave)
  useEffect(() => { saveRef.current = onSave }, [onSave])

  const initial = html?.trim() ? html : text?.trim() ? plainToHtml(text) : ''

  const editor = useEditor({
    // Rendered on the client only: no server markup to match
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: initial,
    editorProps: {
      attributes: { class: 'rich-text focus:outline-none min-h-[64px] px-3 py-2.5 text-sm text-gray-700 leading-relaxed' },
      // Ctrl/Cmd-click opens a link while editing
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a')
        if (a && (event.metaKey || event.ctrlKey)) { window.open(a.href, '_blank', 'noopener'); return true }
        return false
      },
    },
    onCreate: ({ editor: e }) => { saved.current = e.isEmpty ? '' : e.getHTML() },
    onUpdate: ({ editor: e }) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => flush(e), SAVE_AFTER_MS)
    },
    onBlur: ({ editor: e }) => flush(e),
  })

  function flush(e: Editor) {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const nextHtml = e.isEmpty ? '' : e.getHTML()
    if (nextHtml === saved.current) return
    saved.current = nextHtml
    const plain = docToPlain(e.getJSON() as DocNode)
    saveRef.current({ html: nextHtml || null, text: plain || null })
  }

  // Leaving the task (or closing the panel) saves what was typed
  useEffect(() => () => { if (editor && !editor.isDestroyed) flush(editor) }, [editor])

  if (!editor) return <div className="min-h-[96px] rounded-xl bg-gray-50" />
  return (
    <div className="rounded-xl bg-gray-50 border border-transparent focus-within:border-gray-200 focus-within:bg-white transition-colors">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
