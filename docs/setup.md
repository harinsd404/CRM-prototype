# 실행 설명서

처음 받은 사람이 이 순서대로 따라 하면 실행된다. 흐름은 [flow.md](flow.md), 데이터 형식은 [data-format.md](data-format.md).

실행 방법은 두 가지다.

| 모드 | 필요한 것 | 결과 |
|---|---|---|
| **A. 모델 없이 (기본값)** | Python, Node만 | 고정 예시 안 + 자리표시 이미지로 ①~④ 전체 흐름 확인. 5분이면 된다 |
| **B. 실제 생성 (Vertex AI)** | A + 회사 GCP 프로젝트 권한, gcloud, 공식 제품 사진 | Gemini가 실제로 Pod 순서·카피·이미지를 만든다 |

A로 먼저 띄워 본 뒤 B로 바꾸는 순서를 권한다. 바꿀 때는 `backend/.env`만 고치면 된다.

---

## 1. 준비물

| 도구 | 버전 | 확인 명령 | 설치 (macOS) |
|---|---|---|---|
| uv (Python 패키지 관리) | 0.5 이상 | `uv --version` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python | 3.11 이상 | `python3 --version` | 없으면 uv가 알아서 받는다 |
| Node.js | 20.19 이상 또는 22.12 이상 (Vite 8 요구) | `node --version` | `brew install node` |
| pnpm | 9 이상 | `pnpm --version` | `npm install -g pnpm` |
| gcloud CLI | B 모드만 | `gcloud --version` | `brew install --cask google-cloud-sdk` |

Windows는 WSL2 안에서 같은 명령으로 실행한다.

## 2. 코드 받기

```bash
git clone <저장소 주소> CRM-prototype
cd CRM-prototype
```

```text
CRM-prototype/
├── backend/    FastAPI 서버 (포트 8000)
├── frontend/   React 화면 (포트 5173)
└── docs/       문서
```

---

## 3. A. 모델 없이 실행

터미널 두 개를 연다.

### 3-1. 백엔드 (터미널 1)

```bash
cd backend
cp .env.example .env
uv run uvicorn app.main:app --reload
```

- `cp`는 처음 한 번만. `.env.example`의 기본값이 `LLM_PROVIDER=mock`, `IMAGE_PROVIDER=placeholder`라서 그대로 두면 A 모드다.
- `uv run`이 처음 실행될 때 `.venv`를 만들고 `uv.lock`대로 패키지를 설치한다 (따로 `pip install` 필요 없음).
- `Uvicorn running on http://127.0.0.1:8000`이 보이면 성공.

확인:

```bash
curl http://localhost:8000/api/health
```

```json
{"status":"ok","llm_provider":"mock","llm_model":"qwen3:8b","image_provider":"placeholder","images_today":"0/100"}
```

`http://localhost:8000/docs`에서 API를 화면 없이 직접 호출해 볼 수도 있다.

### 3-2. 프론트 (터미널 2)

```bash
cd frontend
pnpm install
pnpm dev
```

- `pnpm install`은 처음 한 번만.
- `Local: http://localhost:5173/`이 보이면 브라우저로 연다.
- 화면의 `/api` 요청은 Vite가 8000번 백엔드로 넘긴다(`vite.config.ts`). **백엔드가 먼저 떠 있어야 한다.**

### 3-3. 화면에서 따라 하기

1. 입력 폼: 페르소나(예: `쇼핑, 패션`)만 적으면 된다. 제품명·컬러·Pod별 스펙은 미리 채워져 있다. **시작**.
2. **① Pod 순서 · 레이아웃** → 생성 → 카드 3개 중 하나 **선택**. (원하면 "순서 · 레이아웃 직접 바꾸기"로 블록을 끌어 고친다)
3. **② 카피** → 생성 → 하나 선택. (직접 수정, 또는 Pod를 골라 수정 요청)
4. **③ 이미지** → 생성(Pod 5개가 차례로 생성됨) → Pod마다 하나씩 선택.
5. **④** 조립 → 미리보기 확인 → 맨 아래 **저장하기**로 ZIP 받기.

A 모드에서는 카드 내용이 `[예시]`로 시작하고 이미지는 색 그라데이션 자리표시다. 흐름과 선택·초기화 동작만 확인하는 모드다.

새로고침해도 주소의 `?run=…`으로 진행 상황이 남는다. 실행 기록은 `backend/data/runs/{run_id}/`에 쌓인다.

---

## 4. B. 실제 생성 (Vertex AI Gemini)

회사 보안 정책상 외부 LLM API는 쓰지 않고, **회사 GCP 프로젝트 안의 Vertex AI**만 쓴다. API 키는 없고 본인 회사 계정으로 인증한다.

### 4-1. GCP 인증 (처음 한 번)

```bash
gcloud auth application-default login
```

브라우저가 열리면 **Vertex AI 권한이 있는 회사 계정**으로 로그인한다. 인증 정보는 `~/.config/gcloud/application_default_credentials.json`에 저장되고 백엔드가 자동으로 읽는다.

### 4-2. 공식 제품 사진 넣기 (이미지 생성용)

`backend/assets/product/`에 아래 이름으로 넣는다. 확장자는 `.png` `.jpg` `.jpeg` `.webp` 중 아무거나. (사내 자료라 git에는 없다. 담당자에게 받는다)

| 파일 이름 | 필수 | 내용 |
|---|---|---|
| `closed_front` | ✔ | 접은 상태 정면 |
| `closed_back` | ✔ | 접은 상태 후면 (카메라 쪽) |
| `unfolded` | ✔ | 펼친 상태 |
| `closed_views` | | 접은 상태 측면·후면·정면을 한 장에 |
| `color_lineup` | | 컬러 라인업. 제품 사진(라벤더)과 다른 색을 고를 때 함께 보낸다 |
| `style_anchor` | | 원하는 사진 톤의 예시 |

필수 사진이 없으면 이미지 단계에서 "공식 제품 사진이 없습니다" 오류가 난다. 텍스트(①②)는 사진 없이도 된다.

선택: `backend/assets/fonts/`에 `SamsungOneArabic-300/400/450/600/700.ttf`를 넣으면 최종 HTML의 영문·숫자가 삼성 폰트로 보인다. 없으면 시스템 폰트로 대체된다.

### 4-3. `backend/.env` 고치기

```env
LLM_PROVIDER=vertex
IMAGE_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=<회사 GCP 프로젝트 ID>
GOOGLE_CLOUD_LOCATION=global
VERTEX_TEXT_MODEL=gemini-3.5-flash
VERTEX_IMAGE_MODEL=gemini-3.1-flash-image
```

텍스트만 실제로 보고 싶으면 `IMAGE_PROVIDER=placeholder`로 두면 된다 (이미지 비용 없음).

### 4-4. 다시 실행하고 확인

`--reload`는 코드 변경만 감지하므로 `.env`를 바꾼 뒤에는 백엔드를 껐다(Ctrl+C) 다시 켠다.

```bash
cd backend
uv run uvicorn app.main:app --reload
```

```bash
curl http://localhost:8000/api/health
```

```json
{"status":"ok","llm_provider":"vertex","llm_model":"gemini-3.5-flash","image_provider":"vertex","images_today":"0/100"}
```

프론트는 그대로 두고 화면에서 3-3과 같이 진행한다. 걸리는 시간(실측): ① 약 7초, ② 약 12초, ③ Pod 하나(이미지 3장)에 약 1~2분.

---

## 5. 설정 값 (`backend/.env`)

| 이름 | 기본값 | 설명 |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock` 고정 예시 / `vertex` Vertex AI Gemini / `openai` OpenAI 호환 서버(Ollama, vLLM) |
| `IMAGE_PROVIDER` | `placeholder` | `placeholder` SVG 자리표시 / `pool` 미리 저장한 이미지 / `vertex` Vertex AI Gemini 이미지 |
| `GOOGLE_CLOUD_PROJECT` | (빈 값) | vertex일 때 필수 |
| `GOOGLE_CLOUD_LOCATION` | `global` | |
| `VERTEX_TEXT_MODEL` | `gemini-3.5-flash` | |
| `VERTEX_THINKING_LEVEL` | `low` | `low`/`medium`/`high`. 높이면 느려진다 (low 약 3초, 기본 약 12초/건) |
| `VERTEX_IMAGE_MODEL` | `gemini-3.1-flash-image` | |
| `IMAGE_CONCURRENCY` | `1` | 동시 이미지 요청 수. 2 이상이면 429가 잦았다 |
| `NUM_OPTIONS` | `3` | 단계마다 만드는 안 개수 |
| `GENERATE_LIMIT_PER_MINUTE` | `10` | 1분당 생성 요청 상한 |
| `IMAGE_DAILY_LIMIT` | `100` | 하루 Vertex 이미지 호출 상한 (재시도 포함) |
| `LLM_BASE_URL`, `LLM_MODEL` | `http://localhost:11434/v1`, `qwen3:8b` | `LLM_PROVIDER=openai`일 때만 |
| `LLM_TEMPERATURE` | `0.9` | |
| `LLM_DISABLE_THINKING` | `true` | `openai`(Qwen3)일 때 생각 모드 끄기 |

## 6. 그 밖의 실행 방법

### 시연 대비: 이미지 풀

이미지 생성이 실패할 때를 대비해, 잘 나온 실행의 이미지를 풀에 저장해 두고 바로 전환할 수 있다.

```bash
cd backend
uv run python scripts/save_pool.py <run_id>
```

`--selected`를 붙이면 선택한 안만 저장한다. 그다음 `.env`에서 `IMAGE_PROVIDER=pool`로 바꾸고 백엔드를 다시 켜면, 이미지 단계가 `assets/image_pool/`에서 같은 Pod·화면비의 이미지를 고른다.

### 로컬 오픈 모델 (선택)

```bash
brew install ollama
ollama pull qwen3:8b
```

`.env`에 `LLM_PROVIDER=openai`. Ollama가 `localhost:11434`에서 떠 있어야 한다.

### 프롬프트 바꾸기

| 파일 | 단계 |
|---|---|
| `backend/app/prompts/pod.md` | ① |
| `backend/app/prompts/copy.md`, `copy_shorten.md`, `copy_revise.md` | ② 생성 / 헤드카피 줄이기 / 수정 요청 |
| `backend/app/prompts/image_brief.md` | ③ 연출안 |
| `backend/app/prompts/image_model.md` | ③ 이미지 모델 프롬프트 (P2) |
| `backend/app/templates/crm.html.j2` | ④ HTML 템플릿 (P3) |

`## system` / `## human` 아래가 각각 시스템·사용자 메시지, `{input_data}` 같은 중괄호는 변수다. LLM 프롬프트(`.md`)는 처음 읽은 뒤 메모리에 두므로 고친 뒤에는 백엔드를 다시 켠다. (`image_model.md`와 HTML 템플릿은 매번 다시 읽는다)

### 프론트 빌드 확인

```bash
cd frontend
pnpm build
```

---

## 7. 문제 해결

| 증상 | 원인 · 해결 |
|---|---|
| 화면에서 모든 요청이 실패, 콘솔에 `ECONNREFUSED` | 백엔드가 꺼져 있다. 3-1을 먼저 실행 |
| `uv: command not found` | 설치 후 터미널을 새로 열거나 `source ~/.zshrc` |
| `pnpm dev`에서 Node 버전 오류 | Node 20.19+ 또는 22.12+로 올린다 |
| `/api/health`가 여전히 `mock` | `.env` 수정 후 백엔드를 다시 켜지 않았다. `.env`가 `backend/` 안에 있는지도 확인 |
| `DefaultCredentialsError` / 403 | 4-1 인증을 안 했거나 그 계정에 Vertex AI 권한이 없다. `GOOGLE_CLOUD_PROJECT` 값 확인 |
| 404 `model … not found` | 프로젝트에서 그 모델을 쓸 수 없다. `VERTEX_TEXT_MODEL` / `VERTEX_IMAGE_MODEL`을 위 기본값으로 |
| "공식 제품 사진이 없습니다" | 4-2의 필수 사진 3장을 넣는다 |
| 429 "생성 요청이 너무 많습니다" | 1분 상한. 표시된 초만큼 기다린다 |
| 429 "오늘 이미지 생성 한도를 넘습니다" | `IMAGE_PROVIDER=pool`로 바꾸거나 `IMAGE_DAILY_LIMIT`을 올린다 |
| 409 "이미 생성 중입니다" | 같은 실행에서 다른 생성이 진행 중. 끝난 뒤 다시 |
| 이미지 생성이 오래 걸리거나 일부 안만 나옴 | Vertex 이미지 모델의 일시 429(용량 부족). 자동으로 기다렸다 다시 시도하고, 성공한 안만 보여준다. 모자라면 그 Pod만 다시 생성 |
| 최종 HTML 글꼴이 다르게 보임 | `assets/fonts/`에 폰트가 없다. 기능에는 영향 없음 |

## 8. 끄기

두 터미널에서 Ctrl+C. 실행 기록을 지우려면 `backend/data/runs/` 아래 폴더를 지운다.
