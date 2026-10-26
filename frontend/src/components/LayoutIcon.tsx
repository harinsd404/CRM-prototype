import type { Layout } from "../types";

/** 레이아웃 모양을 작은 도식으로 보여준다 (텍스트 = 회색 막대, 이미지 = 파란 면). */
export default function LayoutIcon({ layout }: { layout: Layout }) {
  const text = <span className="block h-1 w-3/5 rounded-full bg-gray-400" />;
  const image = <span className="block min-h-0 flex-1 self-stretch rounded-sm bg-primary/60" />;
  return (
    <span className="flex h-7 w-10 shrink-0 overflow-hidden rounded border bg-white p-0.5">
      {layout === "L1" && <span className="flex flex-1 flex-col items-center gap-0.5">{text}{image}</span>}
      {layout === "L2" && <span className="flex flex-1 flex-col gap-0.5">{image}{text}</span>}
      {layout === "L3" && (
        <span className="relative flex flex-1 rounded-sm bg-primary/60">
          <span className="absolute bottom-0.5 left-0.5 block h-1 w-1/2 rounded-full bg-white" />
        </span>
      )}
      {layout === "L4" && <span className="flex flex-1 flex-col gap-0.5 px-1">{image}{text}</span>}
      {layout === "L5" && (
        <span className="flex flex-1 items-center gap-0.5">
          <span className="flex w-1/2 justify-center">{text}</span>
          {image}
        </span>
      )}
    </span>
  );
}
