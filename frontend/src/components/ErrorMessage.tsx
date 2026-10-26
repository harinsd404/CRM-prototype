/** 닫을 수 있는 오류 문구. */
export default function ErrorMessage({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div role="alert" className="mt-3 flex items-start gap-3 rounded-lg bg-danger-soft p-3 text-sm text-danger-strong">
      <p className="flex-1">{message}</p>
      <button onClick={onClose} aria-label="오류 닫기" className="shrink-0 rounded px-1 leading-none hover:bg-white/60">
        ✕
      </button>
    </div>
  );
}
