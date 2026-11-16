import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import type { VisiblePhoto } from "./ProductImagesField";

/** 컬러 하나: 이름(카피·연출안에 쓰는 한국어)과 선택으로 헥스 코드(이미지 생성 때 기준 톤). */
interface ColorRow {
  name: string;
  hex: string; // "" 또는 "#RRGGBB"
}

interface Props {
  value: string; // 서버 형식: "라벤더 #C8B6E2, 그라파이트" (backend state.py parse_colors와 같은 규칙)
  onChange: (value: string) => void;
  photos: VisiblePhoto[]; // 아래 제품 사진 칸에 지금 보이는 사진 (색을 뽑는 후보)
}

const HEX_IN_TEXT = /\(?\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\s*\)?/;
const FULL_HEX = /^#[0-9A-F]{6}$/;

function normalizeHex(raw: string): string {
  let code = raw.trim().replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{3}$/.test(code)) code = code.split("").map((c) => c + c).join("");
  return code ? `#${code}` : "";
}

function parse(value: string): ColorRow[] {
  return value
    .split(",")
    .map((item) => {
      const match = item.match(HEX_IN_TEXT);
      return { name: item.replace(HEX_IN_TEXT, "").trim(), hex: match ? normalizeHex(match[1]) : "" };
    })
    .filter((row) => row.name);
}

function serialize(rows: ColorRow[]): string {
  return rows
    .filter((row) => row.name.trim())
    .map((row) => (FULL_HEX.test(row.hex) ? `${row.name.trim()} ${row.hex}` : row.name.trim()))
    .join(", ");
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

/** 헥스로 대략적인 한국어 색 이름을 붙인다 (자동 추가 때 기본 이름. 사용자가 바로 고친다). */
function guessName(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (s < 0.12 || max - min < 0.06) return l > 0.85 ? "화이트" : l > 0.6 ? "실버" : l > 0.3 ? "그레이" : "블랙";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  if (l > 0.8 && h > 20 && h < 70) return "크림";
  if (h < 15 || h >= 345) return l > 0.7 ? "핑크" : "레드";
  if (h < 40) return l < 0.45 ? "브라운" : "오렌지";
  if (h < 70) return "옐로";
  if (h < 150) return l > 0.6 ? "민트" : "그린";
  if (h < 190) return "민트";
  if (h < 250) return l > 0.65 ? "스카이블루" : "블루";
  if (h < 290) return l > 0.65 ? "라벤더" : "퍼플";
  return "핑크";
}

/** 이름이 겹치면 뒤에 번호를 붙인다. */
function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

/** 사진에서 많이 쓰인 색을 뽑는다. 거의 흰/검은 배경과 투명 픽셀은 뺀다. */
function dominantColors(canvas: HTMLCanvasElement, count = 8): string[] {
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128) continue;
    if (Math.min(r, g, b) > 240 || Math.max(r, g, b) < 15) continue; // 흰 배경·검은 그림자
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const picked: [number, number, number][] = [];
  for (const { n, r, g, b } of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const rgb: [number, number, number] = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    if (picked.every((p) => Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2]) > 48)) picked.push(rgb);
    if (picked.length >= count) break;
  }
  return picked.map(([r, g, b]) => toHex(r, g, b));
}

/** 브라우저 화면 스포이드 (Chrome·Edge). 없는 브라우저에서는 버튼을 숨긴다 */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

/** 컬러 라인업 입력. 컬러마다 원형 색 칩과 '이름(#HEX)'을 나란히 보여 준다.
 * - '사진에서 컬러 뽑기': 아래 제품 사진(또는 올린·붙여 넣은 사진) 위를 클릭할 때마다 컬러가 바로 추가된다. 이름은 색 계열로 자동으로 붙고 그 자리에서 고친다.
 * - 칩을 누르면 이름·헥스를 고치거나 지운다. 이름 칸에 '라벤더 #C8B6E2, 그라파이트'처럼 여러 개를 붙여 넣어도 된다.
 * 헥스는 이미지 생성 때 '기준 톤'으로만 쓰인다 (장면 조명·배경에 맞춰 조금씩 달라질 수 있음). 카피에는 이름만 들어간다. */
export default function ColorLineupField({ value, onChange, photos }: Props) {
  const colors = parse(value);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<ColorRow>({ name: "", hex: "" });
  const [picker, setPicker] = useState<"add" | "draft" | null>(null);
  // '사진에서 컬러 뽑기'에서 다음 클릭이 채울 컬러 (null = 새 컬러로 추가)
  const [target, setTarget] = useState<number | null>(null);
  const nextWithoutHex = (list: ColorRow[], after: number) => {
    const i = list.findIndex((c, j) => j > after && !c.hex);
    return i === -1 ? null : i;
  };

  // 템플릿 적용 등으로 밖에서 값이 통째로 바뀌면 편집을 닫는다
  useEffect(() => {
    if (typeof editing === "number" && editing >= colors.length) setEditing(null);
  }, [colors.length, editing]);

  const open = (target: number | "new") => {
    setEditing(target);
    setDraft(target === "new" ? { name: "", hex: "" } : colors[target]);
  };
  const close = () => setEditing(null);

  const hex = normalizeHex(draft.hex);
  const hexValid = !draft.hex.trim() || FULL_HEX.test(hex);
  const pasted = parse(draft.name); // "라벤더 #C8B6E2, 그라파이트"처럼 여러 개를 한 번에
  const multi = editing === "new" && pasted.length > 1;
  const name = draft.name.replace(HEX_IN_TEXT, "").replace(/,/g, "").trim();
  const duplicate = !multi && colors.some((c, i) => c.name === name && i !== editing);
  const canSave = multi || (!!name && hexValid && !duplicate);

  const save = () => {
    if (!canSave) return;
    if (multi) {
      const names = colors.map((c) => c.name);
      onChange(serialize([...colors, ...pasted.filter((row) => !names.includes(row.name))]));
      setDraft({ name: "", hex: "" });
      return;
    }
    const inline = draft.name.match(HEX_IN_TEXT); // 이름 칸에 헥스까지 적은 경우
    const row = { name, hex: FULL_HEX.test(hex) ? hex : inline ? normalizeHex(inline[1]) : "" };
    onChange(serialize(editing === "new" ? [...colors, row] : colors.map((c, i) => (i === editing ? row : c))));
    if (editing === "new") setDraft({ name: "", hex: "" });
    else close();
  };
  const remove = () => {
    if (typeof editing !== "number") return;
    onChange(serialize(colors.filter((_, i) => i !== editing)));
    close();
  };

  const pickFromScreen = async () => {
    if (!EyeDropper) return;
    try {
      const { sRGBHex } = await new EyeDropper().open();
      setDraft((d) => ({ ...d, hex: normalizeHex(sRGBHex) }));
    } catch {
      /* 취소 */
    }
  };

  const enterSaves = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault(); // 바깥 폼 제출 막기
      save();
    }
  };

  return (
    <div className="block">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          컬러 라인업 <span className="text-danger">*</span>
        </span>
        <button
          type="button"
          onClick={() => {
            setTarget(nextWithoutHex(colors, -1));
            setPicker("add");
          }}
          className="rounded-lg bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary hover:text-white"
        >
          사진에서 컬러 뽑기
        </button>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        사진 위 제품을 클릭할 때마다 컬러가 추가됩니다. 헥스는 이미지 생성 때 기준 톤으로만 쓰이고 배경·조명에 맞춰 조금씩 달라질 수
        있습니다. 카피에는 이름만 들어갑니다.
      </p>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-4">
        {colors.map((color, i) => (
          <button
            key={color.name}
            type="button"
            onClick={() => (editing === i ? close() : open(i))}
            className="group flex min-w-20 flex-col items-center gap-2"
            title="눌러서 고치기"
          >
            <Swatch hex={color.hex} selected={editing === i} />
            <span className="whitespace-nowrap text-sm">
              {color.name}
              {color.hex && <span className="text-gray-500">({color.hex})</span>}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => (editing === "new" ? close() : open("new"))}
          className="flex min-w-20 flex-col items-center gap-2 text-gray-400 hover:text-gray-600"
        >
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed text-2xl ${
              editing === "new" ? "border-primary text-primary" : "border-gray-300"
            }`}
          >
            +
          </span>
          <span className="text-sm">직접 추가</span>
        </button>
      </div>

      {editing !== null && (
        <div className="mt-4 rounded-xl border bg-gray-50 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Swatch hex={FULL_HEX.test(hex) ? hex : ""} size="h-12 w-12" />
            <label className="block min-w-40 flex-1">
              <span className="text-xs text-gray-500">
                컬러 이름{editing === "new" && " · 여러 개는 쉼표로 (예: 라벤더 #C8B6E2, 그라파이트)"}
              </span>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={enterSaves}
                placeholder="예: 라벤더"
                className="mt-1 w-full rounded-lg border bg-white p-2 text-sm"
              />
            </label>
            {!multi && (
              <>
                <label className="block w-32">
                  <span className="text-xs text-gray-500">헥스 (선택)</span>
                  <div className="relative mt-1">
                    <input
                      value={draft.hex}
                      onChange={(e) => setDraft((d) => ({ ...d, hex: e.target.value.trim() }))}
                      onBlur={() => draft.hex && setDraft((d) => ({ ...d, hex: normalizeHex(d.hex) }))}
                      onKeyDown={enterSaves}
                      placeholder="#RRGGBB"
                      className={`w-full rounded-lg border bg-white p-2 pr-9 font-mono text-xs ${
                        hexValid ? "" : "border-danger text-danger"
                      }`}
                    />
                    <label className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 cursor-pointer" title="색 고르기">
                      <span className="block h-full w-full rounded-full border bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" />
                      <input
                        type="color"
                        value={FULL_HEX.test(hex) ? hex.toLowerCase() : "#cccccc"}
                        onChange={(e) => setDraft((d) => ({ ...d, hex: e.target.value.toUpperCase() }))}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                    </label>
                  </div>
                </label>
                {EyeDropper && (
                  <button
                    type="button"
                    onClick={pickFromScreen}
                    className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-100"
                    title="화면의 아무 곳(아래 제품 사진 등)에서 색을 찍습니다"
                  >
                    스포이드
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPicker("draft")}
                  className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-100"
                >
                  사진에서
                </button>
              </>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            {multi && <span className="text-xs text-gray-500">{pasted.length}개를 한 번에 추가합니다.</span>}
            {!hexValid && !multi && <span className="text-xs text-danger">헥스는 #RRGGBB 형식으로 적어 주세요.</span>}
            {duplicate && <span className="text-xs text-danger">같은 이름의 컬러가 이미 있습니다.</span>}
            <span className="flex-1" />
            {typeof editing === "number" && (
              <button type="button" onClick={remove} className="px-2 text-xs text-danger hover:underline">
                지우기
              </button>
            )}
            <button type="button" onClick={close} className="rounded-lg border bg-white px-3 py-1.5 text-xs">
              {editing === "new" ? "닫기" : "취소"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-40"
            >
              {editing === "new" ? "추가" : "저장"}
            </button>
          </div>
        </div>
      )}

      {picker === "add" && (
        <PhotoColorPicker
          photos={photos}
          title="사진에서 컬러 뽑기"
          hint={
            target !== null && colors[target]
              ? `제품 위를 클릭하면 '${colors[target].name}'에 색이 들어가고, 헥스가 빈 다음 컬러로 넘어갑니다.`
              : "제품 위를 클릭할 때마다 새 컬러가 추가됩니다. 이름은 아래에서 바로 고치세요. 아래 컬러를 누르면 그 컬러의 색을 바꿉니다."
          }
          onPick={(picked) => {
            if (target !== null && colors[target]) {
              const next = colors.map((c, j) => (j === target ? { ...c, hex: picked } : c));
              onChange(serialize(next));
              setTarget(nextWithoutHex(next, target));
            } else {
              const names = colors.map((c) => c.name);
              onChange(serialize([...colors, { name: uniqueName(guessName(picked), names), hex: picked }]));
            }
          }}
          onClose={() => setPicker(null)}
        >
          {/* 지금까지의 컬러: 이름을 그 자리에서 고치고 지울 수 있다 */}
          <div className="mt-3 flex flex-wrap gap-2">
            {colors.map((color, i) => (
              <span
                key={i}
                className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2 ${
                  target === i ? "border-primary bg-primary-soft" : "bg-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setTarget(target === i ? null : i)}
                  title="이 컬러의 색을 사진에서 고르기"
                  className={`h-6 w-6 shrink-0 rounded-full ${target === i ? "ring-2 ring-primary" : "ring-1 ring-black/10"}`}
                  style={{ background: color.hex || "#D9D9D9" }}
                />
                <RenameInput
                  value={color.name}
                  taken={colors.filter((_, j) => j !== i).map((c) => c.name)}
                  onRename={(next) => onChange(serialize(colors.map((c, j) => (j === i ? { ...c, name: next } : c))))}
                />
                <span className="font-mono text-[11px] text-gray-400">{color.hex}</span>
                <button
                  type="button"
                  onClick={() => onChange(serialize(colors.filter((_, j) => j !== i)))}
                  className="text-gray-400 hover:text-danger"
                  aria-label={`${color.name} 지우기`}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setTarget(null)}
              className={`rounded-full border border-dashed px-3 py-1 text-xs ${
                target === null ? "border-primary bg-primary-soft text-primary" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              + 새 컬러로 추가
            </button>
          </div>
        </PhotoColorPicker>
      )}
      {picker === "draft" && (
        <PhotoColorPicker
          photos={photos}
          title={`사진에서 색 고르기 · ${name || "새 컬러"}`}
          hint="제품 위를 클릭하면 그 색을 씁니다."
          onPick={(picked) => {
            setDraft((d) => ({ ...d, hex: picked }));
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** 이름 고치기 칸: 입력하는 동안은 로컬로 두고, 포커스를 잃거나 Enter일 때 반영한다 (빈 이름·중복은 되돌린다). */
function RenameInput({ value, taken, onRename }: { value: string; taken: string[]; onRename: (name: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = text.replace(HEX_IN_TEXT, "").replace(/,/g, "").trim();
    if (next && next !== value && !taken.includes(next)) onRename(next);
    else setText(value);
  };
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{ width: `${Math.max(2, text.length) + 0.6}em` }}
      className="rounded border border-transparent bg-transparent px-1 text-sm hover:border-gray-300 focus:border-primary focus:outline-none"
    />
  );
}

/** 원형 색 칩. 헥스가 없으면 회색. */
function Swatch({ hex, selected = false, size = "h-16 w-16" }: { hex: string; selected?: boolean; size?: string }) {
  return (
    <span
      className={`block shrink-0 rounded-full ${size} ${
        selected ? "ring-2 ring-primary ring-offset-2" : "ring-1 ring-black/10 group-hover:ring-black/25"
      }`}
      style={{ background: hex || "#D9D9D9" }}
    />
  );
}

/** 실행 요약 등에서 컬러 라인업을 색 칩으로 보여 준다. */
export function ColorChips({ value }: { value: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 align-middle">
      {parse(value).map((row) => (
        <span key={row.name} className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-full border" style={{ background: row.hex || "#D9D9D9" }} title={row.hex} />
          {row.name}
        </span>
      ))}
    </span>
  );
}

/** 사진에서 색 고르기. 제품 사진 칸의 사진을 바로 고르거나, 파일을 올리거나, 붙여 넣는다(Ctrl+V).
 * 사진 위를 클릭하면 그 지점(5×5 평균) 색을, 아래 후보를 누르면 그 색을 onPick으로 넘긴다. 사진은 서버로 보내지 않는다. */
function PhotoColorPicker({
  photos,
  title,
  hint,
  onPick,
  onClose,
  children,
}: {
  photos: VisiblePhoto[];
  title: string;
  hint: string;
  onPick: (hex: string) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState<string | null>(null); // 지금 보이는 사진 url
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = (url: string, revoke = false) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = canvasRef.current!;
      const scale = Math.min(1, 640 / img.width, 360 / img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (revoke) URL.revokeObjectURL(url);
      try {
        setSuggestions(dominantColors(canvas));
        setError(null);
      } catch {
        setError("이 사진은 색을 읽을 수 없습니다. 파일로 올려 주세요.");
      }
      setCurrent(url);
    };
    img.onerror = () => setError("사진을 불러오지 못했습니다.");
    img.src = url;
  };
  const showFile = (file: File | null | undefined) => {
    if (file?.type.startsWith("image/")) show(URL.createObjectURL(file), true);
  };

  // 처음 열면 '컬러' 사진(없으면 첫 사진)을 띄운다. 붙여 넣기·Esc도 받는다
  useEffect(() => {
    const first = photos.find((p) => p.label.includes("컬러")) ?? photos[0];
    if (first) show(first.url);
    const onPaste = (e: ClipboardEvent) => showFile([...(e.clipboardData?.files ?? [])][0]);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colorAt = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
    const size = 5; // 5×5 평균: 한 픽셀 노이즈를 피한다
    const sx = Math.max(0, Math.min(canvas.width - size, x - 2));
    const sy = Math.max(0, Math.min(canvas.height - size, y - 2));
    const { data } = canvas.getContext("2d")!.getImageData(sx, sy, size, size);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = data.length / 4;
    return toHex(Math.round(r / n), Math.round(g / n), Math.round(b / n));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onClick={onClose}>
      <div
        className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white">
            완료
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">{hint}</p>

        {/* 사진 고르기: 제품 사진 칸의 사진 + 파일 올리기 (붙여 넣기도 됨) */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo) => (
            <button
              key={photo.url}
              type="button"
              onClick={() => show(photo.url)}
              title={photo.label}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-gray-50 ${
                current === photo.url ? "ring-2 ring-primary" : ""
              }`}
            >
              <img src={photo.url} alt={photo.label} className="h-full w-full object-contain" />
            </button>
          ))}
          <label
            className="flex h-14 w-24 shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed text-[11px] leading-tight text-gray-500 hover:bg-gray-50"
            title="파일을 고르거나, 이 창에서 Ctrl+V로 붙여 넣으세요"
          >
            사진 올리기
            <span className="text-gray-400">또는 Ctrl+V</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                showFile(e.target.files?.[0]);
                e.target.value = "";
              }}
              className="hidden"
            />
          </label>
        </div>

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <canvas
          ref={canvasRef}
          onMouseMove={(e) => current && setHover(colorAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => current && onPick(colorAt(e))}
          className={`mt-3 max-w-full cursor-crosshair rounded-lg border ${current ? "" : "hidden"}`}
        />
        {!current && !error && <p className="mt-3 text-xs text-gray-400">위에서 사진을 고르거나 올려 주세요.</p>}

        {current && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">많이 쓰인 색</span>
            {suggestions.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onPick(hex)}
                className="h-6 w-6 rounded-full ring-1 ring-black/10 hover:ring-2 hover:ring-primary"
                style={{ background: hex }}
                title={hex}
              />
            ))}
            {hover && (
              <span className="ml-auto flex items-center gap-1 font-mono text-gray-600">
                <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: hover }} />
                {hover}
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
