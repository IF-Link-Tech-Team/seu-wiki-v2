import { useEffect, useRef, type ReactNode } from "react";

export function ProfileDialog({ children, onCancel }: { children: ReactNode; onCancel?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { dialog.current?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-label="设置我的订阅" onCancel={event => { event.preventDefault(); onCancel?.(); }}
    className="m-auto w-[calc(100%-24px)] max-w-[860px] rounded-3xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/45 backdrop:backdrop-blur-sm"
    style={{ width: "calc(100% - 24px)", maxHeight: "calc(100dvh - 24px)" }}>
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
      <div><h2 className="font-semibold">设置我的订阅</h2><p className="mt-1 text-xs text-ink-3">完成后，为你呈现感兴趣的校园信息</p></div>
      {onCancel && <button type="button" className="rounded-lg px-3 py-2 text-sm hover:bg-bg-sunk" onClick={onCancel}>取消修改</button>}
    </div>
    {children}
  </dialog>;
}
