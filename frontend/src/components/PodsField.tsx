import { MAX_PODS, type TemplatePod } from "../types";

interface Props {
  rows: TemplatePod[]; // enabled = 이번 시안에 쓸지
  onChange: (rows: TemplatePod[]) => void;
  onReset?: () => void; // 템플릿을 불러왔으면 그 템플릿의 Pod로 되돌리기
}

const inputClass = "rounded-lg border bg-white p-2 text-sm";
const fieldClass = `w-full ${inputClass}`;

/** 글자 수 표시 (공백 제외). */
function charCount(text: string): string {
  return `${[...text.replace(/\s/g, "")].length.toLocaleString()}자`;
}

/** 이번 시안에 쓸 Pod 목록. 위에서부터 기본 순서이고, 켜고 끄기·이름과 스펙 고치기·추가·삭제·순서 바꾸기를 할 수 있다. */
export default function PodsField({ rows, onChange, onReset }: Props) {
  const update = (i: number, patch: Partial<TemplatePod>) =>
    onChange(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const move = (i: number, delta: number) => {
    const next = [...rows];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    onChange(next);
  };
  const add = () => onChange([...rows, { name: "", key: "", spec: "", visual: "", enabled: true }]);

  const used = rows.filter((row) => row.enabled);
  const names = used.map((row) => row.name.trim());
  const duplicated = names.filter((name, i) => name && names.indexOf(name) !== i);

  return (
    <fieldset className="space-y-3">
      <legend className="flex w-full items-center justify-between gap-4 text-sm font-medium">
        <span>
          Pod — 체크한 Pod만 이번 시안에 씁니다 ({used.length}개 사용). 위에서부터 기본 순서이고, ①에서 이 순서를 기준으로
          재배치합니다. 스펙을 비워 두면 "(입력 데이터 없음)"으로 처리
        </span>
        {onReset && (
          <button type="button" onClick={onReset} className="shrink-0 text-sm text-gray-500 underline hover:text-gray-900">
            템플릿 내용으로 되돌리기
          </button>
        )}
      </legend>

      {rows.map((row, i) => (
        <div key={i} className={`space-y-2 rounded-lg border p-3 ${row.enabled ? "" : "bg-gray-50 opacity-60"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              aria-label={`${row.name || "새 Pod"} 사용`}
              className="h-4 w-4 accent-primary"
            />
            <input
              value={row.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Pod 이름 (예: 카메라)"
              maxLength={30}
              className={`${inputClass} w-40 font-medium`}
            />
            <input
              value={row.key}
              onChange={(e) => update(i, { key: e.target.value })}
              placeholder="영문 이름 (선택)"
              title="시안 ZIP의 이미지 파일 이름에 씁니다. 비우면 pod1, pod2 …"
              maxLength={30}
              className={`${inputClass} w-36`}
            />
            <div className="ml-auto flex gap-1 text-sm">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="위로"
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                aria-label="아래로"
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-danger"
              >
                삭제
              </button>
            </div>
          </div>
          <div>
            <textarea
              value={row.spec}
              onChange={(e) => update(i, { spec: e.target.value })}
              rows={2}
              placeholder="스펙(Fact) — 카피는 여기 적힌 내용만 근거로 씁니다"
              className={`${fieldClass} block`}
            />
            <p className="mt-0.5 text-right text-[11px] text-gray-400">{charCount(row.spec)}</p>
          </div>
          <input
            value={row.visual}
            onChange={(e) => update(i, { visual: e.target.value })}
            placeholder="이미지 기본 연출 (선택) — 예: 손목에 차고 달리는 장면"
            className={fieldClass}
          />
        </div>
      ))}

      {rows.length < MAX_PODS && (
        <button
          type="button"
          onClick={add}
          className="w-full rounded-lg border border-dashed py-2.5 text-sm text-gray-500 hover:border-primary hover:text-primary"
        >
          + Pod 추가
        </button>
      )}
      {used.length === 0 && <p className="text-xs text-danger">Pod를 하나 이상 체크해 주세요.</p>}
      {names.some((name) => !name) && <p className="text-xs text-danger">체크한 Pod의 이름을 적어 주세요.</p>}
      {duplicated.length > 0 && <p className="text-xs text-danger">Pod 이름이 겹칩니다: {[...new Set(duplicated)].join(", ")}</p>}
    </fieldset>
  );
}

/** 폼 제출 전 검사: PodsField가 보여 주는 오류가 없으면 true */
export function podsValid(rows: TemplatePod[]) {
  const names = rows.filter((row) => row.enabled).map((row) => row.name.trim());
  return names.length > 0 && names.every(Boolean) && new Set(names).size === names.length;
}
