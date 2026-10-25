"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

interface WorkspaceNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export function WorkspaceNameModal({
  isOpen,
  onClose,
  onSubmit,
}: WorkspaceNameModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  const [name, setName] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      setName("");
      dialog.showModal();
    }
    if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (nextName === "") return;
    onSubmit(nextName);
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto w-[min(100%_-_2rem,24rem)] rounded-xl border border-stone-200 bg-white p-0 text-stone-900 shadow-lg open:flex open:flex-col backdrop:bg-stone-900/40"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <form className="flex flex-col gap-4 p-5" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Новый воркспейс</h2>
          <p className="text-sm text-stone-500">Задайте имя рабочего пространства.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium text-stone-700">
            Имя
          </label>
          <input
            id={inputId}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Исследование API"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-100"
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-default disabled:opacity-40"
            disabled={name.trim() === ""}
          >
            Создать
          </button>
        </div>
      </form>
    </dialog>
  );
}
