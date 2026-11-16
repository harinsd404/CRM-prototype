# 실행 설명서

처음 받은 사람이 이 순서대로 따라 하면 실행된다. 흐름은 [flow.md](flow.md), 데이터 형식은 [data-format.md](data-format.md).

실행 방법은 두 가지다.

| 모드 | 필요한 것 | 결과 |
|---|---|---|
| **A. 모델 없이** | Python, Node만 | 고정 예시 안 + 자리표시 이미지로 ①~④ 전체 흐름 확인. 5분이면 된다 |
| **B. 실제 생성 (Vertex AI)** | A + 회사 GCP 프로젝트 권한, gcloud, 공식 제품 사진 | Gemini가 실제로 Pod 순서·카피·이미지를 만든다 |

회사 GCP 권한이 없다면 A로 실행하면 된다. 실제 생성 결과는 시연 영상에서 볼 수 있다. 두 모드는 `backend/.env`의 두 줄로 바꾼다.

---

## 1. 준비물

| 도구 | 버전 | 확인 명령 |
|---|---|---|
| uv (Python 패키지 관리) | 0.5 이상 | `uv --version` |
| Python | 3.11 이상 | `python3 --version` (없으면 uv가 알아서 받는다) |
| Node.js | 20.19 이상 또는 22.12 이상 (Vite 8 요구) | `node --version` |
| pnpm | 9 이상 | `pnpm --version` |
| gcloud CLI | B 모드만 | `gcloud --version` |

없는 도구만 설치한다 (macOS).

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

```bash
brew install node
```

```bash
npm install -g pnpm
```

Windows는 WSL2 안에서 같은 명령으로 실행한다.

## 2. 코드 받기

받는 방법은 둘 중 하나다. 무엇이 들어 있는지가 다르다.

| 받는 방법 | `backend/.env` | 폰트 | 공식 제품 사진 |
|---|---|---|---|
| 전달받은 `CRM-prototype.zip` | 들어 있음 (B 모드 설정, 프로젝트 ID 포함) | 들어 있음 | 들어 있음 |
| `git clone` | 없음 → `.env.example`을 복사 (A 모드로 시작) | 들어 있음 | 들어 있음 |

**ZIP으로 받았다면** 압축을 풀고 그 폴더로 이동한다.

```bash
cd CRM-prototype
```

**GitHub에서 받는다면**

```bash
git clone https://github.com/harinsd404/CRM-prototype.git
```

```bash
cd CRM-prototype/backend && cp .env.example .env
```

```text
CRM-prototype/
├── backend/    FastAPI 서버 (포트 8000)
├── frontend/   React 화면 (포트 5173)
└── docs/       문서
```

---

## 3. A. 모델 없이 실행

### 3-1. 모드 설정

`backend/.env`의 두 줄을 아래처럼 둔다. git clone으로 받아 `.env.example`을 복사했다면 이미 이 값이다.

```env
LLM_PROVIDER=mock
IMAGE_PROVIDER=placeholder
```

터미널을 두 개 연다. **백엔드를 먼저 켠다.**

### 3-2. 백엔드 (터미널 1)

```bash
cd backend
uv run uvicorn app.main:app --reload
```

- `uv run`이 처음 실행될 때 `.venv`를 만들고 `uv.lock`대로 패키지를 설치한다 (따로 `pip install` 필요 없음).
- `Uvicorn running on http://127.0.0.1:8000`이 보이면 성공.

확인:

```bash
curl http://localhost:8000/api/health
```

```json
{"status":"ok","llm_provider":"mock","llm_model":"qwen3:8b","image_provider":"placeholder","image_model":"-","images_today":"0/100"}
```

`http://localhost:8000/docs`에서 API를 화면 없이 직접 호출해 볼 수도 있다.

**로그인 계정 만들기** (처음 한 번). 회원가입 화면은 없고 스크립트로 넣는다. 같은 아이디로 다시 실행하면 비밀번호가 바뀐다.

```bash
uv run python scripts/add_user.py <아이디> <비밀번호>
# DB 도입 전에 만든 실행(data/runs/*/state.json)이 있으면 한 계정으로 가져온다 (한 번만)
uv run python scripts/import_runs.py <아이디>
```

### 3-3. 프론트 (터미널 2)

```bash
cd frontend
pnpm install
pnpm dev
```

- `pnpm install`은 처음 한 번만.
- `Local: http://localhost:5173/`이 보이면 브라우저로 연다.
- 화면의 `/api` 요청은 Vite가 8000번 백엔드로 넘긴다(`vite.config.ts`). **백엔드가 먼저 떠 있어야 한다.**

### 3-4. 화면에서 따라 하기

0. **로그인** → **내 작업** 목록. 예전 실행은 "이어서 만들기", 같은 제품 입력으로 페르소나만 바꾸려면 "다른 페르소나로", 처음부터는 "새로 만들기".
1. **입력**: 제품 템플릿(예: `Galaxy Z Fold`)을 고르면 제품명·컬러·Pod와 스펙이 채워진다. Pod는 켜고 끄기·추가·삭제·순서 바꾸기가 된다. 페르소나(예: `쇼핑, 패션`)를 적고 시작한다.
2. **① Pod 순서 · 레이아웃**: 생성 → 3안 중 하나 선택. "순서 · 레이아웃 직접 바꾸기"로 블록을 끌어 고칠 수도 있다.
3. **② 카피**: 생성 → 하나 선택. 직접 고치거나 Pod를 골라 AI에게 수정을 요청할 수 있다.
4. **③ 이미지**: 생성(Pod가 하나씩 차례로 생성됨) → Pod마다 하나씩 선택.
5. **④ 조립**: 미리보기 확인 → 맨 아래 **저장하기**로 ZIP을 받는다.
6. (선택) 맨 아래 **템플릿으로 저장**: 제품명·컬러·Pod·제품 사진을 새 템플릿으로 저장하거나 기존 템플릿을 덮어쓴다. 다음에 같은 제품으로 만들 때 불러온다.

A 모드에서는 카드 내용이 `[예시]`로 시작하고 이미지는 색 그라데이션 자리표시다. 흐름과 선택·초기화 동작을 확인하는 모드다.

진행 상황은 자동으로 저장되어 새로고침해도(`?run=…`) 내 작업 목록에서도 이어서 만들 수 있다. 실행 상태는 `backend/data/app.db`, 이미지 등 파일은 `backend/data/runs/{run_id}/`에 쌓인다. 실행은 만든 사람에게만 보인다.

---

## 4. B. 실제 생성 (Vertex AI Gemini)

회사 보안 정책상 외부 LLM API는 쓰지 않고, **회사 GCP 프로젝트 안의 Vertex AI**만 쓴다. API 키 없이 각자의 회사 계정으로 인증한다.

### 4-1. GCP 인증 (처음 한 번)

```bash
brew install --cask google-cloud-sdk
```

```bash
gcloud auth application-default login
```

브라우저가 열리면 **Vertex AI 권한이 있는 회사 계정**으로 로그인한다. 인증 정보는 `~/.config/gcloud/application_default_credentials.json`에 저장되고 백엔드가 자동으로 읽는다.

### 4-2. 모드 설정

`backend/.env`를 아래처럼 둔다. ZIP으로 받았다면 처음부터 이 값이고 프로젝트 ID도 채워져 있다.

```env
LLM_PROVIDER=vertex
IMAGE_PROVIDER=vertex
GOOGLE_CLOUD_PROJECT=<회사 GCP 프로젝트 ID>
```

- 텍스트만 실제로 보려면 `IMAGE_PROVIDER=placeholder`로 둔다 (이미지 비용 없음).
- `--reload`는 코드 변경만 감지하므로 `.env`를 바꾼 뒤에는 백엔드를 껐다(Ctrl+C) 다시 켠다.

```bash
curl http://localhost:8000/api/health
```

```json
{"status":"ok","llm_provider":"vertex","llm_model":"gemini-3.5-flash","image_provider":"vertex","image_model":"gemini-3.1-flash-image","images_today":"0/100"}
```

### 4-3. 공식 제품 사진 넣기

③에서 이미지를 만들 때 제품 모양·색의 기준으로 함께 보내는 사진이다. 기본 사진 5장이 `backend/assets/product/`에 들어 있어(git 포함) 따로 넣지 않아도 된다. 다른 사진을 쓰려면 둘 중 하나로 바꾼다.

- **입력 화면에서 올리기**: 입력 폼의 "공식 제품 사진" 칸에서 자리마다 **올리기**(또는 **바꾸기**)를 누른다. 다른 각도·디테일 사진은 **사진 추가**로 5장까지 더 올릴 수 있다. 올린 사진은 그 실행에만 쓰인다 (`data/runs/{run_id}/product/`로 복사됨).
- **폴더에 넣기**: `backend/assets/product/`에 아래 이름으로 넣으면 모든 실행의 기본 사진이 된다. 확장자는 `.png` `.jpg` `.jpeg` `.webp` 중 아무거나.

| 자리 (파일 이름) | 필수 | 내용 |
|---|---|---|
| `closed_front` | ✔ | 접은 앞면 |
| `closed_back` | ✔ | 접은 뒷면 (카메라 쪽) |
| `unfolded` | ✔ | 펼친 상태 |
| `closed_views` | | 접은 상태 측면·뒷면·앞면을 한 장에 |
| `color_lineup` | | 컬러 라인업. 제품 사진(라벤더)과 다른 색을 고를 때 함께 보낸다 |
| `style_anchor` | | 원하는 사진 톤의 예시. 폴더에 넣는 방법만 된다 |

필수 3장이 없으면 그 제품 상태의 이미지는 "공식 제품 사진이 없습니다" 오류가 난다. 텍스트(①②)는 사진 없이도 된다.

폰트(`SamsungOneArabic-300/400/450/600/700.ttf`)는 `backend/assets/fonts/`에 있으면 최종 HTML의 영문·숫자가 삼성 폰트로 보인다. 저장소에 들어 있다.

### 4-4. 걸리는 시간 (실측)

① 약 7초, ② 약 12초, ③ Pod 하나(이미지 3장)에 약 1~2분.

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
| `VERTEX_IMAGE_FALLBACK_MODEL` | `gemini-2.5-flash-image` | 위 모델이 계속 429(쿼터 소진)면 대신 쓸 모델. 비우면 대체하지 않는다 |
| `IMAGE_FALLBACK_MINUTES` | `10` | 대체 모델로 넘어간 뒤 이 시간 동안은 위 모델을 건너뛴다 |
| `IMAGE_CONCURRENCY` | `1` | 동시 이미지 요청 수. 2 이상이면 429가 잦았다 |
| `NUM_OPTIONS` | `3` | 단계마다 만드는 안 개수 |
| `GENERATE_LIMIT_PER_MINUTE` | `10` | 1분당 생성 요청 상한 |
| `IMAGE_DAILY_LIMIT` | `100` | 하루 Vertex 이미지 호출 상한 (재시도 포함) |
| `UPLOAD_MAX_MB` | `10` | 입력 화면에서 올리는 제품 사진 한 장의 최대 크기 |
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
| 화면에서 모든 요청이 실패, 콘솔에 `ECONNREFUSED` | 백엔드가 꺼져 있다. 3-2를 먼저 실행 |
| `uv: command not found` | 설치 후 터미널을 새로 열거나 `source ~/.zshrc` |
| `pnpm dev`에서 Node 버전 오류 | Node 20.19+ 또는 22.12+로 올린다 |
| `/api/health`의 모드가 바뀌지 않는다 | `.env` 수정 후 백엔드를 다시 켜지 않았다. `.env`가 `backend/` 안에 있는지도 확인 |
| `DefaultCredentialsError` / 403 | 4-1 인증을 안 했거나 그 계정에 Vertex AI 권한이 없다. `GOOGLE_CLOUD_PROJECT` 값 확인 |
| 404 `model … not found` | 프로젝트에서 그 모델을 쓸 수 없다. `VERTEX_TEXT_MODEL` / `VERTEX_IMAGE_MODEL`을 위 기본값으로 |
| "공식 제품 사진이 없습니다" | 4-3의 필수 사진 3장을 입력 화면에서 올리거나 `assets/product/`에 넣는다 |
| 제품 사진 올리기가 실패한다 | PNG·JPG·WEBP만, 한 장 10MB 이하만 된다 (`UPLOAD_MAX_MB`) |
| 이미지 생성이 오래 걸리거나 일부 안만 나옴 | 이미지 모델의 일시 429(용량 부족). 자동으로 기다렸다 다시 시도하고, 계속 막히면 대체 모델(`VERTEX_IMAGE_FALLBACK_MODEL`)로 넘어간다. 성공한 안만 보여주니 모자라면 그 Pod만 다시 생성 |
| 429 "생성 요청이 너무 많습니다" | 1분 상한. 표시된 초만큼 기다린다 |
| 429 "오늘 이미지 생성 한도를 넘습니다" | `IMAGE_PROVIDER=pool`로 바꾸거나 `IMAGE_DAILY_LIMIT`을 올린다 |
| 409 "이미 생성 중입니다" | 같은 실행에서 다른 생성이 진행 중. 끝난 뒤 다시 |
| 최종 HTML 글꼴이 다르게 보임 | `assets/fonts/`에 폰트가 없다. 기능에는 영향 없음 |

## 8. 끄기

두 터미널에서 Ctrl+C. 실행 기록을 지우려면 `backend/data/runs/`, 올린 제품 사진은 `backend/data/uploads/` 아래를 지운다.
