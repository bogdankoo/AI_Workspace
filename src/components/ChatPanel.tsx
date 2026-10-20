import type { Workspace } from '@/lib/types'
import { MessageInput } from '@/components/MessageInput'
import { MessageList } from '@/components/MessageList'

interface ChatPanelProps {
  workspace: Workspace
  isPending: boolean
  onSend: (text: string) => void
}

export function ChatPanel({ workspace, isPending, onSend }: ChatPanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-stone-200 px-6 py-4">
        <h2 className="text-base font-medium">{workspace.name}</h2>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <MessageList messages={workspace.messages} isPending={isPending} />
      </div>
      <MessageInput disabled={isPending} onSend={onSend} />
    </section>
  )
}
