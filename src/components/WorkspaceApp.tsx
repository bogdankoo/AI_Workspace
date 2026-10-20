'use client'

import { useState } from 'react'
import { ChatPanel } from '@/components/ChatPanel'
import { WorkspaceList } from '@/components/WorkspaceList'
import { getMockReply } from '@/lib/mockAssistant'
import type { Message, Workspace } from '@/lib/types'

// Счётчик вместо crypto.randomUUID: значение должно быть одинаковым
// при пререндере и гидратации, иначе Next падает на нестабильных данных.
let nextId = 0

function createId(prefix: string): string {
  nextId += 1
  return `${prefix}-${nextId}`
}

function createWorkspace(index: number): Workspace {
  return {
    id: createId('workspace'),
    name: `Воркспейс ${index}`,
    messages: [],
  }
}

function createMessage(role: Message['role'], text: string): Message {
  return { id: createId('message'), role, text, createdAt: Date.now() }
}

export function WorkspaceApp() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => [createWorkspace(1)])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0]

  function handleCreate() {
    const workspace = createWorkspace(workspaces.length + 1)
    setWorkspaces((prev) => [...prev, workspace])
    setActiveId(workspace.id)
  }

  function appendMessage(workspaceId: string, message: Message) {
    setWorkspaces((prev) =>
      prev.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, messages: [...workspace.messages, message] }
          : workspace,
      ),
    )
  }

  async function handleSend(text: string) {
    const prompt = text.trim()
    if (prompt === '') return

    const workspaceId = activeWorkspace.id
    appendMessage(workspaceId, createMessage('user', prompt))
    setIsPending(true)

    const reply = await getMockReply(prompt)

    appendMessage(workspaceId, createMessage('assistant', reply))
    setIsPending(false)
  }

  return (
    <div className="flex h-full">
      <WorkspaceList
        workspaces={workspaces}
        activeId={activeWorkspace.id}
        onSelect={setActiveId}
        onCreate={handleCreate}
      />
      <ChatPanel workspace={activeWorkspace} isPending={isPending} onSend={handleSend} />
    </div>
  )
}
