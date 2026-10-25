"use client";

import { useRef, useState } from "react";
import type { Workspace } from "@/lib/types";
import Image from "next/image";

interface WorkspaceListProps {
  workspaces: Workspace[];
  activeId: string;
  editingId: string | null;
  onSelect: (id: string) => void;
  onOpenModal: () => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

interface WorkspaceNameEditorProps {
  workspace: Workspace;
  onRename: (id: string, name: string) => void;
  onCancel: () => void;
}

function WorkspaceNameEditor({
  workspace,
  onRename,
  onCancel,
}: WorkspaceNameEditorProps) {
  // Черновик живёт здесь: пока печатаем, родительский name не трогаем.
  const [draft, setDraft] = useState(workspace.name);
  // Escape закрывает поле и тоже вызывает blur — без флага blur сохранил бы имя.
  const skipSaveRef = useRef(false);

  return (
    <input
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (skipSaveRef.current) return;
        onRename(workspace.id, draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          skipSaveRef.current = true;
          onCancel();
        }
      }}
      className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-1 py-0.5 text-left text-sm outline-none focus:border-stone-500"
      autoFocus
    />
  );
}

export function WorkspaceList({
  workspaces,
  activeId,
  editingId,
  onSelect,
  onOpenModal,
  onStartEdit,
  onCancelEdit,
  onRename,
  onDelete,
}: WorkspaceListProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-stone-200 bg-white p-4">
      <h1 className="text-lg font-semibold">AI Workspace</h1>
      <button
        type="button"
        className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-left text-sm hover:bg-stone-100"
        onClick={onOpenModal}
      >
        + Новый воркспейс
      </button>
      <ul className="flex flex-col gap-1">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeId;
          return (
            <li key={workspace.id}>
              <div
                className={
                  isActive
                    ? "flex items-center gap-2 rounded-lg bg-stone-200 px-3 py-2 text-sm font-medium"
                    : "flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-stone-100"
                }
              >
                {editingId === workspace.id ? (
                  <WorkspaceNameEditor
                    workspace={workspace}
                    onRename={onRename}
                    onCancel={onCancelEdit}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => onSelect(workspace.id)}
                    >
                      {workspace.name}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer"
                      onClick={() => onStartEdit(workspace.id)}
                    >
                      <Image
                        src="/pencil.svg"
                        width={16}
                        height={16}
                        alt="Change workspace name"
                      />
                    </button>
                    {/* Единственный воркспейс удалять нельзя: кнопка не показывается. */}
                    {workspaces.length > 1 && (
                      <button
                        type="button"
                        className="shrink-0 cursor-pointer"
                        onClick={() => onDelete(workspace.id)}
                      >
                        <Image
                          src="/trash.svg"
                          width={16}
                          height={16}
                          alt="Delete workspace"
                        />
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
