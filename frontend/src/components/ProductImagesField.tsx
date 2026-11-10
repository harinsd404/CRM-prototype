import { useEffect, useState, type ChangeEvent } from "react";
import { api, withBase } from "../api";
import { MAX_EXTRA_PRODUCT_IMAGES, type ProductImage, type RunInput } from "../types";
import { Spinner } from "./icons";

type Choices = NonNullable<RunInput["product_images"]>;

interface Props {
  value: Choices;
  onChange: (value: Choices) => void;
  extras: string[]; // 5자리 외에 더 올린 사진 (올린 파일 이름)
  onExtrasChange: (value: string[]) => void;
}

const ACCEPT = "image/png,image/jpeg,image/webp";
const EXTRA = "extra"; // 추가 사진을 올리는 중일 때 uploading 값

// 이 자리가 비면 그 제품 상태(접은 앞면·뒷면·펼친 상태)의 이미지를 만들 수 없다 (backend steps/image.py)
const REQUIRED_ROLES = ["closed_front", "closed_back", "unfolded"];

/** ③ 이미지 생성 때 이미지 모델에 함께 보내는 공식 제품 사진 5자리. 자리마다 다른 사진을 올리거나 지울 수 있고,
 * 다른 각도·디테일 사진을 MAX_EXTRA_PRODUCT_IMAGES장까지 더 올릴 수 있다. */
export default function ProductImagesField({ value, onChange, extras, onExtrasChange }: Props) {
  const [slots, setSlots] = useState<ProductImage[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProductImages().then(setSlots, (e: Error) => setError(e.message));
  }, []);

  const urlOf = (slot: ProductImage) => {
    const choice = value[slot.role];
    if (choice === undefined) return withBase(slot.default_url);
    return choice === null ? null : withBase(`/api/uploads/${choice}`);
  };

  const set = (role: string, choice: string | null | undefined) => {
    const next = { ...value };
    if (choice === undefined) delete next[role];
    else next[role] = choice;
    onChange(next);
  };

  const upload = async (role: string, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 onChange가 오게
    if (!file) return;
    setUploading(role);
    setError(null);
    try {
      set(role, (await api.upload(file)).name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  };

  // 여러 장을 한 번에 골라도 남은 칸 수만큼만 올린다
  const addExtras = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_EXTRA_PRODUCT_IMAGES - extras.length);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(EXTRA);
    setError(null);
    const added: string[] = [];
    try {
      for (const file of files) added.push((await api.upload(file)).name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      onExtrasChange([...extras, ...added]); // 실패하기 전까지 올린 사진은 남긴다
      setUploading(null);
    }
  };

  const missing = slots.filter((slot) => REQUIRED_ROLES.includes(slot.role) && !urlOf(slot));

  return (
    <fieldset className="space-y-3">
      <legend className="flex w-full items-center justify-between gap-4 text-sm font-medium">
        <span>
          공식 제품 사진 — ③ 이미지를 만들 때 제품 모양·색의 기준으로 함께 보냄. 자리마다 사진을 바꾸거나 지울 수 있고,
          다른 각도·디테일 사진을 {MAX_EXTRA_PRODUCT_IMAGES}장까지 더 올릴 수 있음
        </span>
        <button
          type="button"
          onClick={() => {
            onChange({});
            onExtrasChange([]);
          }}
          className="shrink-0 text-sm text-gray-500 underline hover:text-gray-900"
        >
          기본값으로 되돌리기
        </button>
      </legend>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {slots.map((slot) => {
          const url = urlOf(slot);
          const changed = value[slot.role] !== undefined;
          return (
            <div key={slot.role} className="flex flex-col rounded-lg border p-2">
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-gray-50">
                {uploading === slot.role ? (
                  <Spinner className="h-5 w-5 text-gray-400" />
                ) : url ? (
                  <img src={url} alt={slot.label} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-xs text-gray-400">사진 없음</span>
                )}
              </div>
              <p className="mt-2 text-xs font-medium">
                {slot.label}
                {changed && <span className="ml-1 text-primary">{url ? "· 바꿈" : "· 지움"}</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs">
                <label className="cursor-pointer text-primary hover:underline">
                  {url ? "바꾸기" : "올리기"}
                  <input
                    type="file"
                    accept={ACCEPT}
                    onChange={(e) => upload(slot.role, e)}
                    disabled={uploading !== null}
                    className="hidden"
                  />
                </label>
                {url && (
                  <button type="button" onClick={() => set(slot.role, null)} className="text-gray-500 hover:text-danger">
                    삭제
                  </button>
                )}
                {changed && slot.default_url && (
                  <button type="button" onClick={() => set(slot.role, undefined)} className="text-gray-500 hover:text-gray-900">
                    기본 사진
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {extras.map((name, i) => (
          <div key={name} className="flex flex-col rounded-lg border p-2">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-gray-50">
              <img src={withBase(`/api/uploads/${name}`)} alt={`추가 사진 ${i + 1}`} className="h-full w-full object-contain" />
            </div>
            <p className="mt-2 text-xs font-medium">추가 사진 {i + 1}</p>
            <div className="mt-1.5 text-xs">
              <button
                type="button"
                onClick={() => onExtrasChange(extras.filter((_, j) => j !== i))}
                className="text-gray-500 hover:text-danger"
              >
                삭제
              </button>
            </div>
          </div>
        ))}

        {extras.length < MAX_EXTRA_PRODUCT_IMAGES && (
          <label
            className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-gray-500 ${
              uploading ? "opacity-40" : "cursor-pointer hover:border-primary hover:text-primary"
            }`}
          >
            {uploading === EXTRA ? <Spinner className="h-5 w-5" /> : <span className="text-2xl leading-none">+</span>}
            <span>사진 추가</span>
            <span className="text-gray-400">
              {extras.length}/{MAX_EXTRA_PRODUCT_IMAGES}
            </span>
            <input type="file" accept={ACCEPT} multiple onChange={addExtras} disabled={uploading !== null} className="hidden" />
          </label>
        )}
      </div>

      {missing.length > 0 && (
        <p className="text-xs text-danger">
          {missing.map((slot) => slot.label).join(", ")} 사진이 없으면 그 상태의 제품 이미지는 만들 수 없습니다.
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}
