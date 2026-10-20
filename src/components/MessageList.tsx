import type { Message } from '@/lib/types'

interface MessageListProps {
  messages: Message[]
  isPending: boolean
}

function messageClassName(role: Message['role']): string {
  return role === 'user'
    ? 'max-w-2xl self-end rounded-xl bg-blue-50 px-4 py-2.5'
    : 'max-w-2xl rounded-xl bg-white px-4 py-2.5 ring-1 ring-stone-200'
}

export function MessageList({ messages, isPending }: MessageListProps) {
  if (messages.length === 0 && !isPending) {
    return <p className="text-sm text-stone-500">Напишите первый запрос в этом воркспейсе.</p>
  }

  return (
    <ul className="flex flex-col gap-4">
      {messages.map((message) => (
        <li key={message.id} className={messageClassName(message.role)}>
          <span className="mb-1 block text-xs text-stone-500">
            {message.role === 'user' ? 'Вы' : 'Ассистент'}
          </span>
          <p className="whitespace-pre-wrap">{message.text}</p>
        </li>
      ))}
      {isPending && (
        <li className={messageClassName('assistant')}>
          <span className="mb-1 block text-xs text-stone-500">Ассистент</span>
          <p className="italic text-stone-500">Печатает…</p>
        </li>
      )}
    </ul>
  )
}
