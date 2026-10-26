import type { CopyContent, ImageContent, Option, PodContent, StepName } from "../types";
import { CheckIcon } from "./icons";

interface Props {
  index: number;
  step: StepName;
  option: Option<StepName>;
  selected: boolean;
  edited: boolean;
  disabled: boolean;
  onSelect: () => void;
}

export default function OptionCard({ index, step, option, selected, edited, disabled, onSelect }: Props) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`group flex flex-col rounded-xl border-2 p-4 text-left text-sm transition disabled:cursor-wait ${
        selected ? "border-primary ring-2 ring-primary-soft" : "border-gray-200 hover:border-gray-400"
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-xs text-gray-400">
          {index + 1}번 · {option.angle}
          {edited && <span className="ml-1 text-primary">· 수정됨</span>}
        </span>
        {selected ? (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">
            <CheckIcon className="h-3 w-3" />
            선택됨
          </span>
        ) : (
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-gray-500 opacity-0 transition group-hover:opacity-100">
            클릭해서 선택
          </span>
        )}
      </span>

      {/* 원본 프롬프트 규칙을 코드로 검사한 결과. 사람이 고를 때 참고한다 */}
      {option.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-warning-soft p-2 text-xs text-warning">
          {option.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <div className="mt-2 space-y-2">
        {step === "pod" && <PodBody content={option.content as PodContent} />}
        {step === "copy" && <CopyBody content={option.content as CopyContent} />}
        {step === "image" && <ImageBody content={option.content as ImageContent} />}
      </div>
    </button>
  );
}

function PodBody({ content }: { content: PodContent }) {
  return (
    <>
      <p className="text-gray-600">{content.target_summary}</p>
      <ol className="space-y-1.5">
        {content.items.map((item, i) => (
          <li key={i}>
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {i + 1}. {item.pod}
              </span>
              <span className="rounded bg-gray-100 px-1.5 font-mono text-xs">{item.layout}</span>
            </div>
            <p className="text-xs text-gray-500">{item.reason}</p>
          </li>
        ))}
      </ol>
      <p className="border-t pt-2 text-xs text-gray-500">{content.rationale}</p>
    </>
  );
}

function CopyBody({ content }: { content: CopyContent }) {
  return (
    <>
      <ol className="space-y-3">
        {content.pods.map((p, i) => (
          <li key={i}>
            <p className="text-xs font-semibold text-primary">{p.eyebrow}</p>
            <p className="font-semibold">
              {p.headline}{" "}
              <span className="font-normal text-gray-400">
                ({p.headline.length}자 · {p.headline_type})
              </span>
            </p>
            <p className="text-gray-700">
              {p.body} <span className="text-xs text-gray-400">({p.body.length}자 · {p.ending_order})</span>
            </p>
          </li>
        ))}
      </ol>
      <p className="border-t pt-2 text-xs text-gray-500">{content.rationale}</p>
    </>
  );
}

function ImageBody({ content }: { content: ImageContent }) {
  const { brief } = content;
  return (
    <>
      <img
        src={content.image_url}
        alt={brief.concept}
        style={{ aspectRatio: brief.ratio.replace(":", " / ") }}
        className="w-full rounded-lg object-cover"
      />
      <p className="font-medium">{brief.concept}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-gray-400">유형</dt>
        <dd>{brief.image_type} · {brief.color} · {brief.ratio}</dd>
        <dt className="text-gray-400">장면</dt>
        <dd>{brief.scene}</dd>
        <dt className="text-gray-400">소품</dt>
        <dd>{brief.props}</dd>
        <dt className="text-gray-400">구도</dt>
        <dd>{brief.composition}</dd>
        <dt className="text-gray-400">Safe Zone</dt>
        <dd>{brief.safe_zone}</dd>
      </dl>
    </>
  );
}
