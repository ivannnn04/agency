'use client'

import { useState } from 'react'
import { LinkifiedText } from '@/components/ProjectNotepad'

// Task description that renders links as clickable, and turns into a
// textarea when clicked (blur saves).
export default function EditableDescription({ value, onSave, placeholder }: {
  value: string
  onSave: (text: string) => void
  placeholder: string
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)

  if (editing) {
    return (
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => { setEditing(false); onSave(text) }}
        rows={5}
        placeholder={placeholder}
        className="w-full text-sm text-gray-700 resize-none focus:outline-none placeholder-gray-300 leading-relaxed bg-transparent"
      />
    )
  }

  const startEdit = (e: React.MouseEvent) => {
    // Clicking a link opens it; clicking anywhere else edits
    if ((e.target as HTMLElement).closest('a')) return
    setText(value)
    setEditing(true)
  }

  return value.trim() ? (
    <div
      onClick={startEdit}
      className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words cursor-text min-h-[40px]"
      title="Клікни, щоб редагувати"
    >
      <LinkifiedText content={value} />
    </div>
  ) : (
    <div onClick={startEdit} className="text-sm text-gray-300 cursor-text min-h-[40px]">
      {placeholder}
    </div>
  )
}
