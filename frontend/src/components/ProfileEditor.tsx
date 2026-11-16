import type { ReactNode } from "react";
import type { PhotoSlot, ProductProfile, ProductState } from "../types";

interface Props {
  value: ProductProfile;
  onChange: (value: ProductProfile) => void;
  lockSlots?: boolean; // 템플릿 사진과 묶인 사진 자리는 추가·삭제·key 변경을 막는다
}

const inputClass = "mt-1 w-full rounded-lg border bg-white p-2 text-sm";
const codeClass = "mt-1 w-full rounded-lg border bg-white p-2 font-mono text-xs leading-relaxed";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      {hint && <span className="ml-2 text-[11px] text-gray-400">{hint}</span>}
      {children}
    </label>
  );
}

function Section({ title, hint, children, open }: { title: string; hint: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-lg border">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
        {title} <span className="ml-1 text-xs font-normal text-gray-500">{hint}</span>
      </summary>
      <div className="space-y-3 border-t p-3">{children}</div>
    </details>
  );
}

const rows = (text: string, min = 2) => Math.max(min, Math.min(14, text.split("\n").length + 1));

/** 고급 모드: 제품 프로필(프롬프트의 제품별 블록)을 항목 단위로 고친다. 공통 골격은 코드(prompts/*.md)에 있어 여기서 고치지 않는다. */
export default function ProfileEditor({ value, onChange, lockSlots = false }: Props) {
  const set = <K extends keyof ProductProfile>(key: K, v: ProductProfile[K]) => onChange({ ...value, [key]: v });
  const setSlot = (i: number, patch: Partial<PhotoSlot>) =>
    set("photo_slots", value.photo_slots.map((slot, j) => (j === i ? { ...slot, ...patch } : slot)));
  const setState = (i: number, patch: Partial<ProductState>) =>
    set("states", value.states.map((state, j) => (j === i ? { ...state, ...patch } : state)));
  const text = (key: "device_rules" | "screen_rules" | "edit_rules" | "pod_guide" | "copy_guide" | "visual_guide", code = false) => (
    <textarea
      value={value[key]}
      onChange={(e) => set(key, e.target.value)}
      rows={rows(value[key])}
      className={code ? codeClass : inputClass}
    />
  );

  return (
    <div className="space-y-2">
      <Section title="제품별 가이드" hint="① Pod 기획 · ② 카피 · ③ 연출안 프롬프트 끝에 붙는 한국어 지침" open>
        <Field label="Pod 기획 가이드 (pod_guide)">{text("pod_guide")}</Field>
        <Field label="카피 가이드 (copy_guide)">{text("copy_guide")}</Field>
        <Field label="카피 공식 표기 (copy_terms)" hint="번역·변형하지 않고 그대로 쓸 표기">
          <input value={value.copy_terms} onChange={(e) => set("copy_terms", e.target.value)} className={inputClass} />
        </Field>
        <Field label="연출 가이드 (visual_guide)">{text("visual_guide")}</Field>
      </Section>

      <Section title="기기 묘사" hint="이미지 모델용 영어. 몸체 색은 [제품 컬러]로">
        <Field label="제품 이름 (device_noun)">
          <input value={value.device_noun} onChange={(e) => set("device_noun", e.target.value)} className={inputClass} />
        </Field>
        <Field label="# Device (device_rules)">{text("device_rules", true)}</Field>
        <Field label="# Screen (screen_rules)" hint="화면이 없는 제품이면 비움">
          {text("screen_rules", true)}
        </Field>
        <Field label="출력 전 확인 (check)" hint="· 로 구분">
          <input value={value.check} onChange={(e) => set("check", e.target.value)} className={inputClass} />
        </Field>
        <Field label="이미지 수정 때 지킬 규칙 (edit_rules)">{text("edit_rules", true)}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="사진 속 제품 컬러 (reference_color)">
            <input
              value={value.reference_color}
              onChange={(e) => set("reference_color", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="컬러 라인업 사진 자리 (color_slot)">
            <select
              value={value.color_slot ?? ""}
              onChange={(e) => set("color_slot", e.target.value || null)}
              className={inputClass}
            >
              <option value="">없음</option>
              {value.photo_slots.map((slot) => (
                <option key={slot.key} value={slot.key}>
                  {slot.label} ({slot.key})
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title={`제품 상태 ${value.states.length}개`} hint="연출안이 고르는 상태와 상태별 이미지 규칙">
        {value.states.map((state, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-gray-50 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="key">
                <input value={state.key} onChange={(e) => setState(i, { key: e.target.value })} className={inputClass} />
              </Field>
              <Field label="이름 (label)">
                <input value={state.label} onChange={(e) => setState(i, { label: e.target.value })} className={inputClass} />
              </Field>
              <button
                type="button"
                onClick={() => set("states", value.states.filter((_, j) => j !== i))}
                disabled={value.states.length === 1}
                className="self-end rounded px-2 py-2 text-xs text-gray-500 hover:text-danger disabled:opacity-30"
              >
                삭제
              </button>
            </div>
            <Field label="연출안 작성자용 설명 (brief_hint)">
              <input value={state.brief_hint} onChange={(e) => setState(i, { brief_hint: e.target.value })} className={inputClass} />
            </Field>
            <Field label="이미지 규칙 (rules)" hint="# This view: … 로 시작">
              <textarea
                value={state.rules}
                onChange={(e) => setState(i, { rules: e.target.value })}
                rows={rows(state.rules)}
                className={codeClass}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={state.shows_screen}
                  onChange={(e) => setState(i, { shows_screen: e.target.checked })}
                  className="accent-primary"
                />
                화면이 보임
              </label>
              <Field label="방향">
                <select
                  value={state.orientation}
                  onChange={(e) => setState(i, { orientation: e.target.value as ProductState["orientation"] })}
                  className={inputClass}
                >
                  <option value="any">정하지 않음</option>
                  <option value="portrait">세로 고정</option>
                  <option value="landscape">가로 고정</option>
                </select>
              </Field>
              <Field label="참조 사진 자리 (photos)" hint="쉼표로, 첫 번째가 주 참조">
                <input
                  value={state.photos.join(", ")}
                  onChange={(e) =>
                    setState(i, { photos: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) })
                  }
                  className={inputClass}
                />
              </Field>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            set("states", [
              ...value.states,
              {
                key: `state_${value.states.length + 1}`,
                label: "",
                brief_hint: "",
                rules: "# This view: ",
                shows_screen: false,
                orientation: "any",
                photos: value.photo_slots[0] ? [value.photo_slots[0].key] : [],
              },
            ])
          }
          className="w-full rounded-lg border border-dashed py-2 text-xs text-gray-500 hover:border-primary hover:text-primary"
        >
          + 제품 상태 추가
        </button>
      </Section>

      <Section title={`사진 자리 ${value.photo_slots.length}개`} hint="사진과 함께 이미지 모델에 보내는 설명">
        {value.photo_slots.map((slot, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-gray-50 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
              <Field label="key">
                <input
                  value={slot.key}
                  onChange={(e) => setSlot(i, { key: e.target.value })}
                  disabled={lockSlots}
                  title={lockSlots ? "템플릿 사진과 묶여 있어 바꿀 수 없습니다" : undefined}
                  className={`${inputClass} disabled:bg-gray-100`}
                />
              </Field>
              <Field label="이름 (label)">
                <input value={slot.label} onChange={(e) => setSlot(i, { label: e.target.value })} className={inputClass} />
              </Field>
              <label className="flex items-center gap-1.5 self-end pb-2 text-xs">
                <input
                  type="checkbox"
                  checked={slot.required}
                  onChange={(e) => setSlot(i, { required: e.target.checked })}
                  className="accent-primary"
                />
                필수
              </label>
              {!lockSlots && (
                <button
                  type="button"
                  onClick={() => set("photo_slots", value.photo_slots.filter((_, j) => j !== i))}
                  className="self-end rounded px-2 py-2 text-xs text-gray-500 hover:text-danger"
                >
                  삭제
                </button>
              )}
            </div>
            <Field label="설명 (caption)">
              <textarea
                value={slot.caption}
                onChange={(e) => setSlot(i, { caption: e.target.value })}
                rows={rows(slot.caption)}
                className={codeClass}
              />
            </Field>
          </div>
        ))}
        {!lockSlots && (
          <button
            type="button"
            onClick={() =>
              set("photo_slots", [
                ...value.photo_slots,
                { key: `photo_${value.photo_slots.length + 1}`, label: "", caption: "[Product reference — ]", required: false },
              ])
            }
            className="w-full rounded-lg border border-dashed py-2 text-xs text-gray-500 hover:border-primary hover:text-primary"
          >
            + 사진 자리 추가
          </button>
        )}
      </Section>
    </div>
  );
}
