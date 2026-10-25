"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { WorkspaceDeleteModal } from "@/components/WorkspaceDeleteModal";
import { WorkspaceList } from "@/components/WorkspaceList";
import { WorkspaceNameModal } from "@/components/WorkspaceNameModal";
import { getMockReply } from "@/lib/mockAssistant";
import type { Message, Workspace } from "@/lib/types";

// Счётчик вместо crypto.randomUUID: значение должно быть одинаковым
// при пререндере и гидратации, иначе Next падает на нестабильных данных.
// После Fast Refresh модуль перезагружается и nextId снова 0, а useState
// сохраняется — без syncNextId новый воркспейс получит уже занятый id.
let nextId = 0;

function syncNextId(ids: Iterable<string>) {
  for (const id of ids) {
    const suffix = id.slice(id.lastIndexOf("-") + 1);
    const n = Number(suffix);
    if (Number.isFinite(n) && n > nextId) nextId = n;
  }
}

function createId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function allEntityIds(workspaces: Workspace[]): string[] {
  return workspaces.flatMap((workspace) => [
    workspace.id,
    ...workspace.messages.map((message) => message.id),
  ]);
}

function createWorkspace(index: number, name?: string): Workspace {
  const trimmed = name?.trim() ?? "";
  return {
    id: createId("workspace"),
    name: trimmed === "" ? `Воркспейс ${index}` : trimmed,
    messages: [],
  };
}

function createMessage(role: Message["role"], text: string): Message {
  return { id: createId("message"), role, text, createdAt: Date.now() };
}

export function WorkspaceApp() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => [
    createWorkspace(1),
  ]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Ожидание привязано к воркспейсу: иначе индикатор и блокировка ввода
  // «переезжают» в чат, к которому запрос не относится.
  const [pendingWorkspaceIds, setPendingWorkspaceIds] = useState<string[]>([]);
  // Одновременно переименовывать можно только один воркспейс.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0];
  const isActiveWorkspacePending = pendingWorkspaceIds.includes(
    activeWorkspace.id,
  );
  const deletingWorkspace = workspaces.find(
    (workspace) => workspace.id === deletingId,
  );

  const [isModalOpen, setIsModalOpen] = useState(false);

  function handleCreate(name: string) {
    // id создаём здесь, а не внутри updater: updater может выполниться позже,
    // и тогда setActiveId получил бы пустой id.
    syncNextId(allEntityIds(workspaces));
    const workspace = createWorkspace(workspaces.length + 1, name);
    setWorkspaces((prev) => [...prev, workspace]);
    setActiveId(workspace.id);
  }

  function appendMessage(
    workspaceId: string,
    role: Message["role"],
    text: string,
  ) {
    syncNextId(allEntityIds(workspaces));
    const message = createMessage(role, text);
    setWorkspaces((prev) =>
      prev.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, messages: [...workspace.messages, message] }
          : workspace,
      ),
    );
  }

  function setWorkspacePending(workspaceId: string, pending: boolean) {
    setPendingWorkspaceIds((prev) => {
      const isPending = prev.includes(workspaceId);
      if (isPending === pending) return prev;
      return pending
        ? [...prev, workspaceId]
        : prev.filter((id) => id !== workspaceId);
    });
  }

  async function handleSend(text: string) {
    const prompt = text.trim();
    if (prompt === "") return;

    const workspaceId = activeWorkspace.id;
    appendMessage(workspaceId, "user", prompt);
    setWorkspacePending(workspaceId, true);

    try {
      const reply = await getMockReply(prompt);
      appendMessage(workspaceId, "assistant", reply);
    } catch {
      appendMessage(
        workspaceId,
        "assistant",
        "Не удалось получить ответ. Попробуйте ещё раз.",
      );
    } finally {
      setWorkspacePending(workspaceId, false);
    }
  }

  function handleRename(id: string, nextName: string) {
    const name = nextName.trim();
    setEditingId(null);
    if (name === "") return;

    setWorkspaces((prev) =>
      prev.map((workspace) =>
        workspace.id === id ? { ...workspace, name } : workspace,
      ),
    );
  }

  function handleConfirmDelete() {
    const id = deletingId;
    if (id === null) return;

    setDeletingId(null);
    setWorkspaces((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((workspace) => workspace.id !== id);
    });
    setPendingWorkspaceIds((prev) =>
      prev.filter((pendingId) => pendingId !== id),
    );
    setActiveId((prev) => (prev === id ? null : prev));
    setEditingId((prev) => (prev === id ? null : prev));
  }

  return (
    <div className="flex h-full">
      <WorkspaceList
        workspaces={workspaces}
        activeId={activeWorkspace.id}
        editingId={editingId}
        onSelect={setActiveId}
        onOpenModal={() => setIsModalOpen(true)}
        onStartEdit={setEditingId}
        onCancelEdit={() => setEditingId(null)}
        onRename={handleRename}
        onDelete={setDeletingId}
      />
      <ChatPanel
        workspace={activeWorkspace}
        isPending={isActiveWorkspacePending}
        onSend={handleSend}
      />
      <WorkspaceNameModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreate}
      />
      <WorkspaceDeleteModal
        isOpen={deletingId !== null}
        workspaceName={deletingWorkspace?.name ?? ""}
        onCancel={() => setDeletingId(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
