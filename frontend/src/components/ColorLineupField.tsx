import { useEffect, useRef, useState, type ChangeEvent } from "react";

/** 컬러 한 줄: 이름(카피·연출안에 쓰는 한국어)과 선택으로 헥스 코드(이미지 생성 때 기준 톤). */
interface ColorRow {
  name: string;
  hex: string; // "" 또는 "#RRGGBB" (입력 중에는 불완전할 수 있다)
}

interface Props {
  value: string; // 서버 형식: "라벤더 #C8B6E2, 그라파이트" (backend state.py parse_colors와 같은 규칙)
  onChange: (value: string) => void;
}

const HEX_IN_TEXT = /\(?\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\s*\)?/;
const FULL_HEX = /^#[0-9a-fA-F]{6}$/;

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
    .map((row) => (FULL_HEX.test(row.hex) ? `${row.name.trim()} ${row.hex.toUpperCase()}` : row.name.trim()))
    .join(", ");
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

/** 사진에서 많이 쓰인 색을 뽑는다. 거의 흰/검은 배경과 투명 픽셀은 뺀다. */
function dominantColors(canvas: HTMLCanvasElement, count = 6): string[] {
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (min > 240 || max < 15) continue; // 흰 배경·검은 그림자
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

/** 컬러 라인업 입력. 컬러마다 원형 색 칩과 '이름(#HEX)'을 나란히 보여 주고, 칩을 누르면 아래에서 고친다.
 * 헥스는 선택이며 직접 쓰거나 색 고르기·화면 스포이드·사진에서 뽑을 수 있다.
 * 헥스는 이미지 생성 때 '기준 톤'으로만 쓰인다 (장면 조명·배경에 맞춰 조금씩 달라질 수 있음). 카피에는 이름만 들어간다. */
export default function ColorLineupField({ value, onChange }: Props) {
  const colors = parse(value);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<ColorRow>({ name: "", hex: "" });
  const [picking, setPicking] = useState(false);

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
  const name = draft.name.replace(/,/g, "").trim();
  const duplicate = colors.some((c, i) => c.name === name && i !== editing);
  const canSave = !!name && hexValid && !duplicate;

  const save = () => {
    if (!canSave) return;
    const row = { name, hex: FULL_HEX.test(hex) ? hex : "" };
    onChange(serialize(editing === "new" ? [...colors, row] : colors.map((c, i) => (i === editing ? row : c))));
    // 새로 추가했으면 바로 다음 컬러를 적을 수 있게 칸을 비워 둔다
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

  return (
    <div className="block">
      <span className="text-sm font-medium">
        컬러 라인업 <span className="text-danger">*</span>
      </span>
      <p className="mt-0.5 text-xs text-gray-500">
        헥스는 선택입니다. 이미지 생성 때 기준 톤으로만 쓰이고, 배경·조명에 맞춰 조금씩 달라질 수 있습니다. 카피에는 이름만 들어갑니다.
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
          <span className="text-sm">컬러 추가</span>
        </button>
      </div>

      {editing !== null && (
        <div className="mt-4 rounded-xl border bg-gray-50 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Swatch hex={FULL_HEX.test(hex) ? hex : ""} size="h-12 w-12" />
            <label className="block min-w-40 flex-1">
              <span className="text-xs text-gray-500">컬러 이름</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.replace(/,/g, "") }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault(); // 바깥 폼 제출 막기
                    save();
                  }
                }}
                placeholder="예: 라벤더"
                className="mt-1 w-full rounded-lg border bg-white p-2 text-sm"
              />
            </label>
            <label className="block w-32">
              <span className="text-xs text-gray-500">헥스 (선택)</span>
              <div className="relative mt-1">
                <input
                  value={draft.hex}
                  onChange={(e) => setDraft((d) => ({ ...d, hex: e.target.value.trim() }))}
                  onBlur={() => draft.hex && setDraft((d) => ({ ...d, hex: normalizeHex(d.hex) }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      save();
                    }
                  }}
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
              onClick={() => setPicking(true)}
              className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-100"
              title="사진을 올려 많이 쓰인 색을 뽑거나 원하는 지점을 클릭합니다"
            >
              사진에서
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            {!hexValid && <span className="text-xs text-danger">헥스는 #RRGGBB 형식으로 적어 주세요.</span>}
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

      {picking && (
        <PhotoColorPicker
          colorName={name || "새 컬러"}
          onPick={(picked) => {
            setDraft((d) => ({ ...d, hex: picked }));
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
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

/** 사진 한 장을 올려 대표 색 후보를 보여 주고, 사진 위 아무 지점이나 클릭해 그 색을 고르게 한다. 사진은 서버로 보내지 않는다. */
function PhotoColorPicker({
  colorName,
  onPick,
  onClose,
}: {
  colorName: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);

  const load = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      const scale = Math.min(1, 560 / img.width, 360 / img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      setSuggestions(dominantColors(canvas));
      setLoaded(true);
    };
    img.src = url;
  };

  const colorAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
    // 5×5 평균: 한 픽셀 노이즈를 피한다
    const size = 5;
    const sx = Math.max(0, Math.min(canvas.width - size, x - 2));
    const sy = Math.max(0, Math.min(canvas.height - size, y - 2));
    const { data } = canvas.getContext("2d")!.getImageData(sx, sy, size, size);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const n = data.length / 4;
    return toHex(Math.round(r / n), Math.round(g / n), Math.round(b / n));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">사진에서 색 고르기 · {colorName}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="닫기">
            ×
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          제품 사진을 고르면 많이 쓰인 색을 보여 줍니다. 사진 위를 클릭하면 그 지점의 색을 씁니다. 사진은 서버에 올라가지 않습니다.
        </p>
        <input type="file" accept="image/*" onChange={load} className="mt-3 block text-sm" />
        <canvas
          ref={canvasRef}
          onMouseMove={(e) => loaded && setHover(colorAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => loaded && onPick(colorAt(e))}
          className={`mt-3 max-w-full cursor-crosshair rounded-lg border ${loaded ? "" : "hidden"}`}
        />
        {loaded && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">후보</span>
            {suggestions.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onPick(hex)}
                className="flex items-center gap-1 rounded-lg border px-1.5 py-1 font-mono hover:bg-gray-50"
              >
                <span className="h-4 w-4 rounded border" style={{ background: hex }} />
                {hex}
              </button>
            ))}
            {hover && (
              <span className="ml-auto flex items-center gap-1 font-mono text-gray-600">
                <span className="h-4 w-4 rounded border" style={{ background: hover }} />
                {hover}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
