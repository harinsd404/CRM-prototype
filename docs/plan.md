# CRM 시안 생성 프로토타입 — 계획

## 1. 목표

1~8주차에 만든 프롬프트(POD 순서, 카피, 이미지)를 하나의 흐름으로 연결하고,
**각 단계에서 AI가 N개 안을 만들고 → 사람이 하나를 골라(필요하면 수정해) → 다음 단계로 넘기는**
사람 검수형(Human-in-the-loop) 프로토타입을 만든다. 서버 배포 없이 로컬에서 동작하면 된다.

## 2. 흐름

```
입력 (타겟 페르소나, 소구 강도(HOT/WARM/COLD), 이미 사용된 1순위 Pod, 제품명, 컬러, Pod별 스펙)
 ↓
① Pod 순서·레이아웃 N안  ← LLM (P1 Order/Layout Rules)        → [1개 선택 / 수정 / 재생성]
 ↓ 5개 Pod 순서 + Pod별 L1~L5
② 카피 N안               ← LLM (P1 Writing Rules, ①을 전제로)  → [1개 선택 / 수정 / 재생성]
 ↓ Pod별 eyebrow·헤드·바디
③ 이미지 (Pod마다)       ← LLM이 이미지 Input Data 작성 → P2 프롬프트 + 이미지 모델
                           Pod 5개 각각 N안                     → [Pod마다 1개 선택 / Pod별 재생성]
 ↓
④ 최종 CRM 시안          ← P3 규칙을 옮긴 Jinja2 템플릿 조립 (LLM 사용 안 함) → 미리보기
```

원본 프롬프트(`backend/app/prompts/original/`)와의 관계
- **P1(POD+카피+이미지 연출 통합)** → ① `pod.md`, ② `copy.md`, ③ `image_brief.md`로 나눴다. 과제가 "POD를 고른 뒤 카피"를 요구하고, 경량 모델은 한 번에 적게 시킬수록 안정적이기 때문.
- **P2(이미지)** → `image_model.md`에 그대로 두고, 코드가 맨 뒤에 Pod별 이미지 Input Data를 붙여 이미지 모델에 보낸다.
- **P3(HTML)** → `templates/crm.html.j2`로 옮겼다. 디자인 토큰과 L1~L5 정의가 확정적이라 LLM 없이 템플릿으로 조립하는 편이 정확하다.
- **P1의 [7] 자가 점검** → 코드 검사로 바꿨다 (`postprocess`). 글자 수, 헤드카피 유형 분포, 어미 배열 중복, 1순위 중복, 이동 Pod 수, 레이아웃 연속/종류를 검사해 카드에 경고로 보여준다. 레이아웃으로 정해지는 값(화면비, L3 외 Safe Zone, eyebrow)은 코드가 직접 맞춘다.

규칙
- 단계는 **슬롯 1개 이상**으로 이루어진다. ①②는 슬롯 하나, ③은 Pod마다 슬롯 하나.
- 각 단계는 **바로 앞 단계가 모두 선택되어야** 생성할 수 있다 (아니면 API가 400).
- 어떤 단계를 다시 생성하거나 다시 선택하면 **그 뒤 단계는 초기화**된다. 앞 단계가 바뀌면 뒤 단계의 전제가 깨지기 때문.
- N개 안은 한 번에 받지 않고 **안마다 다른 방향(angle)을 주어 N번 병렬 호출**한다. 경량 모델이 여러 안을 한 번에 쓰면 품질과 형식이 무너지기 때문.
- 이미지에는 **글자를 넣지 않는다.** 카피는 HTML 템플릿에서 텍스트로 얹는다.
- **수정 요청**: 사람이 말로 고칠 점을 주면 AI가 반영한다. 이미지 한 장(원본 이미지 + 제품 사진을 함께 보내 그 부분만 고침, 원래 안은 남김), 이미지 Pod 하나(요청을 반영해 3안 다시 생성), 카피 Pod 하나(나머지 Pod는 그대로).
- **폭주 방지** (`core/guard.py`): 한 실행에서 생성은 한 번에 하나(409), 생성 요청은 1분에 10회까지(429), Vertex 이미지 호출은 하루 100장까지(재시도 포함, `data/usage.json`). 화면의 버튼 잠금은 새로고침·다른 탭·스크립트에는 효과가 없어 서버에도 둔다.

## 3. 기술 스택과 선택 이유

| 구분 | 선택 | 이유 |
|---|---|---|
| 프론트 | React + Vite + TypeScript, pnpm | 단계별 카드 선택 UI를 컴포넌트 하나(`StepPanel`)로 재사용. Vite는 설정 없이 빠르게 뜸. 타입으로 백엔드 상태와 맞춤 |
| 스타일 | Tailwind CSS v4 | 빌드 시 CSS 생성(런타임 비용 없음), 클래스 이름 고민 없이 빠르게 작성 |
| 백엔드 | FastAPI + uv | 단계별 API(`generate`/`select`)로 흐름이 코드에 드러남. `/docs`로 프론트 없이 검증 |
| LLM 연결 | LangChain (`langchain-google-genai`, `langchain-openai`) | 단계 코드는 모델을 몰라도 된다. `with_structured_output(method="json_schema")`로 안을 스키마대로 받고, 모델 교체는 `.env`의 `LLM_PROVIDER`만 바꾼다 |
| 텍스트 모델 | **Vertex AI Gemini** (`gemini-3.5-flash`) | 회사 보안 정책상 외부 LLM API는 불가하지만, 회사 GCP 프로젝트 안의 Vertex AI는 사용 승인됨(ADC 인증, API 키 없음). 처음엔 오픈 모델(Qwen3-8B) 자체 서빙을 계획했으나 회사 GCP 런타임에 GPU가 없어 바꿨다. 오픈 모델 경로(`LLM_PROVIDER=openai`, Ollama/vLLM)는 코드에 남겨 둠 |
| 이미지 모델 | **Vertex AI Gemini 이미지** (`gemini-2.5-flash-image`, 설정으로 변경) | 회사 GCP 프로젝트 안에서 사용 승인됨. P2가 전제한 대로 공식 제품 사진(①)과 스타일 앵커(②)를 참조 이미지로 함께 보낼 수 있다. 회사 GCP에 GPU가 없어 자체 서빙 이미지 모델은 불가 |
| HTML 조립 | Jinja2 템플릿 | 경량 모델의 HTML 생성은 레이아웃이 자주 깨짐. "생성은 AI, 조립은 결정적 로직" |
| 저장 | JSON 파일 + 로컬 이미지 폴더 | 배포 없음. 실행 하나 = 폴더 하나라 단계별 기록을 그대로 보여줄 수 있음 |

## 4. 실행 모드 (`backend/.env`)

| 설정 | 값 | 용도 |
|---|---|---|
| `LLM_PROVIDER` | `mock` | 모델 없이 흐름 개발 (고정된 예시 안 반환) |
| | `vertex` | Vertex AI Gemini 호출 (`VERTEX_TEXT_MODEL`) |
| | `openai` | OpenAI 호환 서버 호출 (`LLM_BASE_URL`로 Ollama 또는 vLLM 지정) |
| `IMAGE_PROVIDER` | `placeholder` | SVG 자리표시 이미지 생성 (GPU 불필요) |
| | `pool` | `assets/image_pool/`의 미리 만든 이미지 사용 (시연 장애 대비) |
| | `vertex` | Vertex AI Gemini 호출. `assets/product/`의 공식 제품 사진을 참조 이미지로 첨부 |

Vertex AI는 `gcloud auth application-default login` 인증으로 호출한다 (README 참고).

## 5. 폴더 구조

```
backend/
  app/
    main.py              FastAPI 앱, /api 라우터, /api/files 정적 파일
    config.py            .env 설정
    llm.py               채팅 모델 생성: Vertex Gemini / OpenAI 호환 (모델 교체 지점)
    api/runs.py          실행 생성·조회, 단계 생성·선택, 조립·미리보기
    core/
      domain.py          Pod 이름, 레이아웃, 화면비 규칙 등 도메인 상수
      state.py           RunState / StepState / SlotState / Option, 단계 순서
      store.py           data/runs/{id}/state.json 읽기·쓰기
      prompts.py         prompts/*.md → ChatPromptTemplate
      guard.py           폭주 방지: 실행별 잠금, 분당 요청 상한, 하루 이미지 상한
      render.py          HTML 합성용 JSON(P1 [8] 형식) + Jinja2 조립
    steps/
      base.py            Step 공통 틀 (슬롯마다 N개 병렬 생성 → postprocess 규칙 검사)
      pod.py copy.py image.py
    providers/image.py   placeholder / pool / vertex
    prompts/
      original/          1~8주차 원본 프롬프트 P1·P2·P3 (보관용)
      pod.md copy.md image_brief.md   단계별 LLM 프롬프트 (P1에서 분리)
      image_model.md     이미지 모델용 프롬프트 (P2)
    templates/crm.html.j2  P3 규칙을 옮긴 HTML 템플릿
  assets/product/        공식 제품 사진 closed_front / closed_back / unfolded (+ closed_views, color_lineup, style_anchor)
  assets/image_pool/     pool 모드용 이미지 ({Pod 영문명}/{화면비}_*.png)
  scripts/save_pool.py   실행 하나의 이미지를 image_pool에 저장
  assets/fonts/          SamsungOneArabic-300~700.ttf (영문·숫자만, 한글은 시스템 폰트로 대체. git 제외)
  data/runs/             실행 기록 (git 제외)
frontend/
  src/ App.tsx api.ts types.ts components/
infra/llm/               vLLM 실행 스크립트 (GPU 런타임 가능 여부 확인 전까지 보류)
docs/plan.md
```

## 6. API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/runs` | 입력 데이터로 실행 생성 (Pod별 스펙이 하나도 없으면 422) |
| GET | `/api/runs/{id}` | 현재 상태 (UI는 이걸로 화면을 그림) |
| POST | `/api/runs/{id}/steps/{step}/generate?slot=` | N안 생성 / 재생성 (`step` = `pod`·`copy`·`image`). `slot`을 주면 그 Pod만. body `{feedback}`을 주면 사람의 수정 요청을 모든 안에 반영 |
| POST | `/api/runs/{id}/steps/{step}/revise` | `{slot, index, request, pod?}` 수정 요청. 이미지: 그 이미지를 고친 새 안을 추가·선택 / 카피: 그 안의 Pod 하나만 다시 쓰기 |
| POST | `/api/runs/{id}/steps/{step}/select` | `{slot?, index, edited?}` 선택(+수정) 저장. 수정본도 같은 규칙으로 검사 |
| POST | `/api/runs/{id}/render` | 최종 HTML 조립 + `html_input.json`(P1 [8] 형식) 저장 |
| GET | `/api/runs/{id}/preview` | 조립된 HTML 미리보기 |

## 7. 일정 (7일)

1. 골격: 백엔드·프론트 연결, mock 모드로 ①~④ 전체 흐름 ✅
2. 1~8주차 프롬프트 이식 (P1을 POD/카피/이미지 연출로 분리, P3를 템플릿으로, 자가 점검을 코드 검사로) ✅
3. 텍스트를 Vertex Gemini로 연결, ①②③ 실제 생성 확인, 카피 프롬프트 보강 ✅
4. Vertex Gemini 이미지 Provider, 제품 사진 연결, P2 렌즈 정보 채우기, 실제 생성 확인 ✅
5. HTML 화면 확인, 카피 수정 UI(JSON → 폼, 글자 수 표시) ✅
6. 예외 처리(안별 재시도, 시간 제한, 동시 요청 제한), 시연 대비 이미지 풀 ✅ → 시연 리허설
7. 영상 촬영, 이 문서를 바탕으로 "구조 및 선택 이유" 정리

## 8. 남은 결정 / 리스크

- **회사 GCP는 Colab Enterprise(e2-standard-4, GPU 없음).** 그래서 자체 서빙 대신 Vertex AI Gemini를 텍스트·이미지 모두에 쓴다. 백엔드가 로컬에서 Vertex를 직접 호출하므로 Colab 런타임은 켜지 않는다. `infra/llm`(vLLM)은 참고용으로만 남김.
- 프로젝트에서 호출 가능한 모델은 확인 결과 텍스트 `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview`, 이미지 `gemini-2.5-flash-image` (2026-10-25).
- **이미지 비용·할당량.** 전체 생성 1회에 Pod 5개 × N안(기본 15장). 동시 요청은 `IMAGE_CONCURRENCY`(기본 3)로 제한한다. 단가와 프로젝트 할당량은 GCP 콘솔에서 확인.
- ③은 Pod별로 따로 생성하므로 P1의 "5개 Pod 전체에서 손·인물·배경 연출 2종 이상" 규칙은 자동으로 보장되지 않는다. 안마다 연출 방향(제품 단독 / 손·인물 / 배경)을 다르게 줘서 사람이 고를 때 섞을 수 있게 했다.
- P1의 일부 규칙(바디 첫 문장 구조, 타겟 유형별 금지 어휘, 명사형 목적어)은 코드로 검사하지 않는다. 모델과 사람의 검수에 맡긴다.
- 첫 실제 생성에서 스펙에 없는 효익(예: "발열 걱정 없이")을 쓰는 안이 있었다. 프롬프트에서 스펙 밖 주장을 금지하고, 팩트체크 근거가 입력 원문에 실제로 있는지 코드로 대조한다. 근거 목록에 적지 않은 주장까지는 잡지 못하므로 사람 검수가 필요하다.
- 헤드카피 20자 제한은 프롬프트만으로는 자주 넘겼다(모델이 글자 수를 정확히 세지 못함). 코드가 길이를 세어 넘긴 헤드카피만 다시 줄이게 하는 보정 호출을 둔다.

## 9. 실측 (2026-10-26, gemini-3.5-flash, N=3)

| 항목 | 결과 |
|---|---|
| 생성 시간 | ① 약 7초, ② 약 12초, ③ 연출안 15건 약 15초 (이미지 생성 시간 제외) |
| 생각 수준 | `VERTEX_THINKING_LEVEL=low`로 호출 1건이 12초 → 3초 |
| 이미지 429 | Vertex 이미지 모델이 간헐적으로 429(공유 용량 부족)를 돌려준다. 동시 1장, 429면 5초·15초 뒤 다시 시도, 일부 안만 실패하면 성공한 안만 보여준다. Pod 하나(3장)에 약 1~2분 |
| 멈춤 | 15건 동시 호출 중 2건이 50분 넘게 응답이 없었다. 클라이언트 timeout이 듣지 않아 `asyncio.wait_for`(45초)로 끊고 그 안만 다시 시도한다. 동시 요청은 6건으로 제한 |
