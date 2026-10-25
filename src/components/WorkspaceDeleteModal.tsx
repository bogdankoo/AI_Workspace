"use client";

import { useEffect, useRef } from "react";

interface WorkspaceDeleteModalProps {
  isOpen: boolean;
  workspaceName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function WorkspaceDeleteModal({
  isOpen,
  workspaceName,
  onCancel,
  onConfirm,
}: WorkspaceDeleteModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto w-[min(100%_-_2rem,24rem)] rounded-xl border border-stone-200 bg-white p-0 text-stone-900 shadow-lg open:flex open:flex-col backdrop:bg-stone-900/40"
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current) onCancel();
      }}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Удалить воркспейс?</h2>
          <p className="text-sm text-stone-500">
            «{workspaceName}» и вся его история сообщений будут удалены без
            возможности восстановления.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-100"
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            type="button"
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
            onClick={onConfirm}
          >
            Удалить
          </button>
        </div>
      </div>
    </dialog>
  );
}
