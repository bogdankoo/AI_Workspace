import type { Workspace } from '@/lib/types'

interface WorkspaceListProps {
  workspaces: Workspace[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
}

export function WorkspaceList({ workspaces, activeId, onSelect, onCreate }: WorkspaceListProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-stone-200 bg-white p-4">
      <h1 className="text-lg font-semibold">AI Workspace</h1>
      <button
        type="button"
        className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-left text-sm hover:bg-stone-100"
        onClick={onCreate}
      >
        + Новый воркспейс
      </button>
      <ul className="flex flex-col gap-1">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeId
          return (
            <li key={workspace.id}>
              <button
                type="button"
                className={
                  isActive
                    ? 'w-full rounded-lg bg-stone-200 px-3 py-2 text-left text-sm font-medium'
                    : 'w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100'
                }
                onClick={() => onSelect(workspace.id)}
              >
                {workspace.name}
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
