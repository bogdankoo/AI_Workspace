'use client'

import { useState } from 'react'

interface MessageInputProps {
  disabled: boolean
  onSend: (text: string) => void
}

export function MessageInput({ disabled, onSend }: MessageInputProps) {
  const [text, setText] = useState('')

  function handleSubmit() {
    if (text.trim() === '' || disabled) return
    onSend(text)
    setText('')
  }

  return (
    <form
      className="flex items-end gap-3 border-t border-stone-200 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <textarea
        className="flex-1 resize-none rounded-lg border border-stone-300 bg-white px-3 py-2.5 outline-none focus:border-stone-500"
        value={text}
        placeholder="Введите запрос…"
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            handleSubmit()
          }
        }}
      />
      <button
        type="submit"
        className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-default disabled:opacity-40"
        disabled={disabled || text.trim() === ''}
      >
        Отправить
      </button>
    </form>
  )
}
