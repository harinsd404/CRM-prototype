# CRM 시안 생성 프로토타입 — 계획

## 1. 목표

1~8주차에 만든 프롬프트(POD 순서, 카피, 이미지)를 하나의 흐름으로 연결하고,
**각 단계에서 AI가 N개 안을 만들고 → 사람이 하나를 골라(필요하면 수정해) → 다음 단계로 넘기는**
사람 검수형(Human-in-the-loop) 프로토타입을 만든다. 서버 배포 없이 로컬에서 동작하면 된다.

## 2. 흐름

```
입력 (타겟 페르소나, 무드, 이미 사용된 1순위 Pod, 제품명, 컬러, Pod별 스펙)
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

## 3. 기술 스택과 선택 이유

| 구분 | 선택 | 이유 |
|---|---|---|
| 프론트 | React + Vite + TypeScript, pnpm | 단계별 카드 선택 UI를 컴포넌트 하나(`StepPanel`)로 재사용. Vite는 설정 없이 빠르게 뜸. 타입으로 백엔드 상태와 맞춤 |
| 스타일 | Tailwind CSS v4 | 빌드 시 CSS 생성(런타임 비용 없음), 클래스 이름 고민 없이 빠르게 작성 |
| 백엔드 | FastAPI + uv | 단계별 API(`generate`/`select`)로 흐름이 코드에 드러남. `/docs`로 프론트 없이 검증 |
| LLM 연결 | LangChain (`langchain-openai`) | OpenAI 호환 서버(vLLM/Ollama)에 `base_url`만 바꿔 연결. `with_structured_output(method="json_schema")`로 안을 구조화해서 받음. 모델 교체가 쉬움 |
| 텍스트 모델 | Qwen3-8B (대안: Gemma 3 12B) | 회사 보안 정책상 외부 LLM API 불가 → 회사 GCP에 오픈 모델 자체 서빙. 한국어·JSON 지시 수행 양호, Apache 2.0 |
| 모델 서빙 | **재검토 중** — 로컬 Ollama(M4 Pro) 우선 | 회사 GCP는 Colab Enterprise e2-standard-4(GPU 없음)라 vLLM 불가. 코드는 OpenAI 호환 `base_url`만 바꾸면 되므로 서빙 위치가 바뀌어도 영향 없음 |
| 이미지 모델 | **Vertex AI Gemini 이미지** (`gemini-2.5-flash-image`, 설정으로 변경) | 회사 GCP 프로젝트 안에서 사용 승인됨. P2가 전제한 대로 공식 제품 사진(①)과 스타일 앵커(②)를 참조 이미지로 함께 보낼 수 있다. 회사 GCP에 GPU가 없어 자체 서빙 이미지 모델은 불가 |
| HTML 조립 | Jinja2 템플릿 | 경량 모델의 HTML 생성은 레이아웃이 자주 깨짐. "생성은 AI, 조립은 결정적 로직" |
| 저장 | JSON 파일 + 로컬 이미지 폴더 | 배포 없음. 실행 하나 = 폴더 하나라 단계별 기록을 그대로 보여줄 수 있음 |

## 4. 실행 모드 (`backend/.env`)

| 설정 | 값 | 용도 |
|---|---|---|
| `LLM_PROVIDER` | `mock` | 모델 없이 흐름 개발 (고정된 예시 안 반환) |
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
    llm.py               ChatOpenAI 생성 (모델 교체 지점)
    api/runs.py          실행 생성·조회, 단계 생성·선택, 조립·미리보기
    core/
      domain.py          Pod 이름, 레이아웃, 화면비 규칙 등 도메인 상수
      state.py           RunState / StepState / SlotState / Option, 단계 순서
      store.py           data/runs/{id}/state.json 읽기·쓰기
      prompts.py         prompts/*.md → ChatPromptTemplate
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
  assets/product/        공식 제품 사진 closed_front / closed_back / unfolded (+ style_anchor)
  assets/image_pool/     pool 모드용 이미지
  assets/fonts/          SamsungOne 폰트 (없으면 sans-serif)
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
| POST | `/api/runs/{id}/steps/{step}/generate?slot=` | N안 생성 / 재생성 (`step` = `pod`·`copy`·`image`). `slot`을 주면 그 Pod만 |
| POST | `/api/runs/{id}/steps/{step}/select` | `{slot?, index, edited?}` 선택(+수정) 저장. 수정본도 같은 규칙으로 검사 |
| POST | `/api/runs/{id}/render` | 최종 HTML 조립 + `html_input.json`(P1 [8] 형식) 저장 |
| GET | `/api/runs/{id}/preview` | 조립된 HTML 미리보기 |

## 7. 일정 (7일)

1. 골격: 백엔드·프론트 연결, mock 모드로 ①~④ 전체 흐름 ✅
2. 1~8주차 프롬프트 이식 (P1을 POD/카피/이미지 연출로 분리, P3를 템플릿으로, 자가 점검을 코드 검사로) ✅ → 로컬 Ollama로 실제 생성
3. GCP L4 VM에 vLLM 서빙, IAP 터널 연결, 품질 확인
4. Vertex Gemini 이미지 Provider ✅ → 인증·제품 사진 준비 후 실제 생성, P2의 제품별 자리({렌즈 수} 등) 채우기
5. HTML 템플릿 다듬기, 카피 수정 UI 개선(JSON → 폼)
6. 예외 처리(생성 실패 재시도, 타임아웃), 시연 시나리오 리허설
7. 영상 촬영, 이 문서를 바탕으로 "구조 및 선택 이유" 정리

## 8. 남은 결정 / 리스크

- **회사 GCP는 Colab Enterprise(e2-standard-4, GPU 없음, 3시간 Idle Shutdown).** `infra/`의 GCE+vLLM 계획은 그대로 쓸 수 없다. GPU 런타임 가능 여부, 로컬 실행 허용 여부를 확인 중.

- GCP GPU(L4) 할당량 확인. 없으면 CPU + 양자화 모델(느림) 또는 pool 모드로 시연.
- **이미지 비용·할당량.** 전체 생성 1회에 Pod 5개 × N안(기본 15장). 동시 요청은 `IMAGE_CONCURRENCY`(기본 3)로 제한한다. 단가와 프로젝트 할당량은 GCP 콘솔에서 확인.
- ③은 Pod별로 따로 생성하므로 P1의 "5개 Pod 전체에서 손·인물·배경 연출 2종 이상" 규칙은 자동으로 보장되지 않는다. 안마다 연출 방향(제품 단독 / 손·인물 / 배경)을 다르게 줘서 사람이 고를 때 섞을 수 있게 했다.
- P1의 일부 규칙(바디 첫 문장 구조, 타겟 유형별 금지 어휘, 명사형 목적어)은 코드로 검사하지 않는다. 모델과 사람의 검수에 맡긴다.
- 경량 모델 한국어 카피 품질 → 안 되면 Gemma 3 12B / 국내 모델과 비교.
