import { useEffect } from "react";
import type { ImageContent } from "../types";

interface Props {
  content: ImageContent;
  title: string;
  onClose: () => void;
}

/** 이미지 크게 보기. 배경을 누르거나 Esc로 닫는다. */
export default function ImageLightbox({ content, title, onClose }: Props) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-gray-900/85 p-6"
    >
      <img
        src={content.image_url}
        alt={content.brief.concept}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
      />
      <div className="max-w-3xl text-center text-sm text-white">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-gray-300">{content.brief.concept}</p>
      </div>
      <button onClick={onClose} className="rounded-full bg-white/15 px-4 py-1.5 text-sm text-white hover:bg-white/25">
        닫기 (Esc)
      </button>
    </div>
  );
}
