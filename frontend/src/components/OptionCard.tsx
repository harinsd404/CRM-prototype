import { withBase } from "../api";
import { useState, type KeyboardEvent } from "react";
import type { CopyContent, ImageContent, Option, PodContent, StepName } from "../types";
import { LAYOUT_LABELS } from "../types";
import { CheckIcon } from "./icons";
import ImageLightbox from "./ImageLightbox";
import LayoutIcon from "./LayoutIcon";

interface Props {
  index: number;
  step: StepName;
  option: Option<StepName>;
  original: Option<StepName> | null; // 사람이 고친 경우 AI가 처음 만든 안. 바뀐 곳을 표시하는 데 쓴다
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}

type PodItem = PodContent["items"][number];
type PodCopy = CopyContent["pods"][number];

const copyChanged = (a: PodCopy, b: PodCopy | undefined) => !b || a.headline !== b.headline || a.body !== b.body;
const podChanged = (item: PodItem, i: number, before: PodContent) =>
  before.items[i]?.pod !== item.pod || before.items[i]?.layout !== item.layout;

/** AI가 만든 안에서 사람이(또는 AI 수정 요청으로) 바뀐 곳의 수 */
function countChanges(step: StepName, content: unknown, original: unknown): number {
  if (step === "pod") {
    const before = original as PodContent;
    return (content as PodContent).items.filter((item, i) => podChanged(item, i, before)).length;
  }
  if (step === "copy") {
    const before = (original as CopyContent).pods;
    return (content as CopyContent).pods.filter((p) =>
      copyChanged(
        p,
        before.find((b) => b.pod === p.pod),
      ),
    ).length;
  }
  return 0;
}

// 이미지 수정 요청으로 생긴 안은 angle이 "N번 수정 · 요청"이다 (backend/app/api/runs.py revise_option)
const REVISED_IMAGE = /^(\d+)번 수정 · (.+)$/;

export default function OptionCard({ index, step, option, original, selected, disabled, onSelect }: Props) {
  const changes = original ? countChanges(step, option.content, original.content) : 0;
  const revisedFrom = step === "image" ? REVISED_IMAGE.exec(option.angle) : null;
  // 안에 "크게 보기" 버튼을 넣어야 해서 <button> 대신 버튼 역할의 div로 만든다
  const choose = () => !disabled && onSelect();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      choose();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected}
      aria-disabled={disabled}
      onClick={choose}
      onKeyDown={onKeyDown}
      className={`group flex cursor-pointer flex-col rounded-xl border-2 bg-white p-4 text-left text-sm transition ${
        disabled ? "cursor-wait" : ""
      } ${selected ? "border-primary ring-2 ring-primary-soft" : "border-gray-200 hover:border-gray-400"}`}
    >
      {/* 머리: 안 번호 + 이 안의 방향 */}
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-bold ${
              selected ? "bg-primary-soft text-primary-pressed" : "bg-gray-100 text-gray-600"
            }`}
          >
            {index + 1}안
          </span>
          {original && (
            <span className="rounded-md bg-ink px-2 py-0.5 text-xs font-semibold text-white">
              ✎ 수정됨{changes > 0 && ` · ${changes}곳`}
            </span>
          )}
          {revisedFrom && (
            <span className="rounded-md bg-ink px-2 py-0.5 text-xs font-semibold text-white">
              ✎ {revisedFrom[1]}안 수정본
            </span>
          )}
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
      <p className="mt-2 leading-snug font-semibold text-ink">
        {revisedFrom ? `요청: ${revisedFrom[2]}` : option.angle}
      </p>

      {/* 원본 프롬프트 규칙을 코드로 검사한 결과. 사람이 고를 때 참고한다 */}
      {option.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-warning-soft p-2 text-xs text-warning">
          {option.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <div className="mt-2 space-y-2">
        {step === "pod" && (
          <PodBody content={option.content as PodContent} original={(original?.content as PodContent) ?? null} />
        )}
        {step === "copy" && (
          <CopyBody content={option.content as CopyContent} original={(original?.content as CopyContent) ?? null} />
        )}
        {step === "image" && (
          <ImageBody content={option.content as ImageContent} title={`${index + 1}번 · ${option.angle}`} />
        )}
      </div>
    </div>
  );
}

// 카드 아래쪽에 접어 두는 "이 안의 의도" 설명. 펼쳐도 카드가 선택되지 않게 클릭을 막는다
function Rationale({ label, text }: { label: string; text: string }) {
  return (
    <details onClick={(e) => e.stopPropagation()} className="border-t pt-2 text-xs">
      <summary className="cursor-pointer text-gray-400 hover:text-gray-700">{label}</summary>
      <p className="mt-1 leading-relaxed text-gray-600">{text}</p>
    </details>
  );
}

// 바뀐 블록: 왼쪽 굵은 선과 옅은 배경
const CHANGED_BLOCK = "border-gray-200 border-l-4 border-l-ink bg-gray-50";

function ChangedTag() {
  return <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-white">수정</span>;
}

function PodBody({ content, original }: { content: PodContent; original: PodContent | null }) {
  const [fullReasons, setFullReasons] = useState(false); // 근거가 두 줄에서 잘려 비교하기 어려웠다 (QA)
  return (
    <>
      <p className="rounded-lg bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-600">
        <span className="mr-1 font-semibold text-gray-700">타겟</span>
        {content.target_summary}
      </p>
      <ol className="space-y-1.5">
        {content.items.map((item, i) => {
          const changed = original !== null && podChanged(item, i, original);
          const before = original?.items.find((b) => b.pod === item.pod);
          const fromIndex = original ? original.items.findIndex((b) => b.pod === item.pod) : i;
          return (
            <li key={i} className={`rounded-lg border p-2.5 ${changed ? CHANGED_BLOCK : "border-gray-200"}`}>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="font-semibold text-ink">{item.pod}</span>
                {changed && <ChangedTag />}
                <span className="flex-1" />
                <span className="flex items-center gap-1.5" title={LAYOUT_LABELS[item.layout]}>
                  <LayoutIcon layout={item.layout} />
                  <span className="font-mono text-xs text-gray-500">{item.layout}</span>
                </span>
              </div>
              {changed && before && (
                <p className="mt-1.5 text-xs text-gray-500">
                  AI 원안:{" "}
                  <span className="line-through">
                    {fromIndex + 1}번째 · {before.layout}
                  </span>
                </p>
              )}
              <p className={`mt-1.5 text-xs leading-relaxed text-gray-500 ${fullReasons ? "" : "line-clamp-2"}`} title={item.reason}>
                {item.reason}
              </p>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // 카드 선택과 따로
          setFullReasons(!fullReasons);
        }}
        className="text-xs text-gray-500 underline hover:text-gray-900"
      >
        {fullReasons ? "Pod별 근거 줄이기" : "Pod별 근거 전체 보기"}
      </button>
      <Rationale label="이 순서로 구성한 이유" text={content.rationale} />
    </>
  );
}

function CopyBody({ content, original }: { content: CopyContent; original: CopyContent | null }) {
  return (
    <>
      <ol className="space-y-1.5">
        {content.pods.map((p, i) => {
          const before = original?.pods.find((b) => b.pod === p.pod);
          const changed = original !== null && copyChanged(p, before);
          return (
            <li key={i} className={`rounded-lg border p-3 ${changed ? CHANGED_BLOCK : "border-gray-200"}`}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                {p.eyebrow}
                {changed && <ChangedTag />}
              </p>
              <p className="mt-1 text-[15px] leading-snug font-bold text-ink">{p.headline}</p>
              <p className="mt-1.5 leading-relaxed text-gray-700">{p.body}</p>
              {/* 규칙 검사에 쓰는 값: 글자 수(기준은 backend/app/steps/copy.py), 헤드카피 유형, 어미 배열 */}
              <p className="mt-2 flex flex-wrap gap-1 text-[11px] text-gray-500">
                <span
                  className={`rounded px-1.5 py-0.5 ${p.headline.length > 20 ? "bg-danger-soft text-danger" : "bg-gray-100"}`}
                >
                  헤드 {p.headline.length}/20자
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 ${p.body.length > 110 ? "bg-danger-soft text-danger" : "bg-gray-100"}`}
                >
                  바디 {p.body.length}/110자
                </span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5">유형 {p.headline_type}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5">어미 {p.ending_order}</span>
                {p.target_scene && <span className="rounded bg-primary-soft px-1.5 py-0.5">타겟 장면 {p.target_scene}</span>}
              </p>
              {/* 바뀐 Pod는 AI가 처음 쓴 문구를 접어 둔다 */}
              {changed && before && (
                <details onClick={(e) => e.stopPropagation()} className="mt-2 text-xs">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-800">AI 원안 보기</summary>
                  <div className="mt-1 rounded bg-white p-2 text-gray-500">
                    {before.headline !== p.headline && <p className="font-semibold line-through">{before.headline}</p>}
                    {before.body !== p.body && <p className="mt-0.5 line-through">{before.body}</p>}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      <Rationale label="카피 기획 의도" text={content.rationale} />
    </>
  );
}

function ImageBody({ content, title }: { content: ImageContent; title: string }) {
  const { brief } = content;
  const [zoomed, setZoomed] = useState(false);
  return (
    <>
      <div className="relative">
        <img
          src={withBase(content.image_url)}
          alt={brief.concept}
          style={{ aspectRatio: brief.ratio.replace(":", " / ") }}
          className="w-full rounded-lg bg-gray-100 object-cover"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(true);
          }}
          className="absolute right-2 bottom-2 rounded-full bg-gray-900/70 px-2.5 py-1 text-xs text-white hover:bg-gray-900"
        >
          ⤢ 크게 보기
        </button>
      </div>
      {zoomed && <ImageLightbox content={content} title={title} onClose={() => setZoomed(false)} />}
      <p className="font-medium">{brief.concept}</p>
      <p className="text-xs text-gray-500">
        {brief.image_type} · {brief.color} · {brief.ratio}
      </p>
      {/* 연출 세부는 길어서 접어 둔다. 펼쳐도 카드가 선택되지 않게 클릭을 막는다 */}
      <details onClick={(e) => e.stopPropagation()} className="text-xs">
        <summary className="cursor-pointer text-gray-400 hover:text-gray-700">연출 자세히</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <dt className="text-gray-400">장면</dt>
          <dd>{brief.scene}</dd>
          <dt className="text-gray-400">소품</dt>
          <dd>{brief.props}</dd>
          <dt className="text-gray-400">구도</dt>
          <dd>{brief.composition}</dd>
          <dt className="text-gray-400">Safe Zone</dt>
          <dd>{brief.safe_zone}</dd>
        </dl>
      </details>
    </>
  );
}
