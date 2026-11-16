# 흐름도

각 단계에서 **AI가 3개 안을 만들고 → 코드가 규칙을 검사하고 → 사람이 하나를 골라(고쳐서) → 고른 결과만 다음 단계로 넘어가는** 구조다.
데이터 형식은 [data-format.md](data-format.md), 실행 방법은 [setup.md](setup.md).

## 1. 전체 흐름

범례: 🟦 AI 생성 · ⬜ 코드 처리 · 🟧 사람이 선택하는 지점 · 🟩 저장되는 데이터 · 실선 화살표 = 데이터 이동 · 점선 = 되돌아가기

```mermaid
flowchart TD
    IN[/"🟧 입력 폼<br/>타겟 페르소나 · 소구 강도 · 이미 쓴 1순위 Pod<br/>제품명 · 컬러 · Pod별 스펙"/]
    IN -- "RunInput<br/>POST /api/runs" --> S0[("🟩 실행 생성<br/>DB runs + data/runs/{run_id}/")]

    %% ① Pod 순서·레이아웃
    S0 -- "RunInput" --> G1["🟦 ① Pod 순서·레이아웃 생성<br/>prompts/pod.md × 방향 3개 병렬"]
    G1 -- "PodOption × 3" --> C1["⬜ 규칙 검사 check_pod_plan<br/>모든 Pod·1순위 중복·이동 ⌈0.6n⌉개·레이아웃 연속/min(5,⌈0.8n⌉)종"]
    C1 -- "Option × 3 (+warnings)" --> H1{"🟧 사람: ① 선택"}
    H1 -- "다시 생성 (+수정 요청 feedback)" --> G1
    H1 -- "직접 수정: 블록 끌어서 순서·레이아웃 변경" --> C1b["⬜ 같은 규칙으로 재검사"]
    C1b --> H1
    H1 -- "선택 = Pod 순서 + Pod별 L1~L5" --> D1[("🟩 steps.pod.slots.main<br/>selected / edited")]

    %% ② 카피
    D1 -- "RunInput + Pod 순서·레이아웃" --> G2["🟦 ② 카피 생성<br/>prompts/copy.md × 방향 3개 병렬"]
    G2 --> FIX2["🟦 헤드카피 20자 초과분만 다시 줄이기<br/>prompts/copy_shorten.md"]
    FIX2 -- "CopyOption × 3" --> C2["⬜ 규칙 검사 check_copy<br/>글자 수·헤드 유형·어미 배열·팩트체크 원문 대조<br/>eyebrow = Pod명으로 고정"]
    C2 -- "Option × 3 (+warnings)" --> H2{"🟧 사람: ② 선택"}
    H2 -- "다시 생성 (+feedback)" --> G2
    H2 -- "수정 요청: Pod 여러 개/전체 + 요청 문장" --> R2["🟦 고른 Pod만 다시 쓰기<br/>prompts/copy_revise.md"]
    R2 --> C2
    H2 -- "직접 수정: 헤드·바디 편집" --> C2
    H2 -- "선택 = Pod별 eyebrow·헤드·바디" --> D2[("🟩 steps.copy.slots.main")]

    %% ③ 이미지 (Pod마다)
    D2 -- "Pod별 레이아웃 + 헤드·바디" --> LOOP["⬜ Pod를 하나씩 차례로 요청<br/>generate?slot={Pod}"]
    LOOP --> G3["🟦 ③-a 이미지 연출안 생성<br/>prompts/image_brief.md 1번 → 서로 다른 3안"]
    G3 -- "ImageBrief" --> N3["⬜ 화면비·Safe Zone을 레이아웃에 맞춤<br/>image_model.md에서 정면·후면·펼침 등 필요한 섹션만 + 연출안 → 이미지 프롬프트"]
    N3 -- "프롬프트 + 공식 제품 사진" --> G3b["🟦 ③-b 이미지 모델<br/>gemini-3.1-flash-image"]
    G3b -- "ImageOption × 3 (이미지 파일)" --> C3["⬜ 규칙 검사 check_brief<br/>컬러 라인업·L3 금지어·얼굴/손"]
    C3 --> H3{"🟧 사람: Pod마다 1개 선택"}
    H3 -- "이 Pod만 다시 생성 (+feedback)" --> G3
    H3 -- "이미지 한 장 수정 요청" --> R3["🟦 원본 이미지 + 제품 사진 + 요청<br/>→ 고친 새 안을 추가·선택"]
    R3 --> H3
    H3 -- "선택 = Pod별 이미지 + 화면비" --> D3[("🟩 steps.image.slots.{Pod} × 5<br/>images/*.png")]

    %% ④ 조립
    D3 -- "①②③ 선택 결과" --> J4["⬜ ④ 조립 POST /render<br/>html_input.json(P1 [8] 형식) → Jinja2 템플릿(P3)<br/>LLM 사용 안 함"]
    J4 --> D4[("🟩 RunState.html (DB)<br/>html_input.json")]
    D4 --> H4{"🟧 사람: 미리보기 확인"}
    H4 -- "저장하기" --> OUT[/"ZIP: index.html · images/ · fonts/ · html_input.json"/]

    %% 앞 단계 변경
    H1 -. "①을 다시 고르거나 고치면 ②③은 유지<br/>②의 Pod 순서만 따라 맞춤, 화면비가 안 맞는 이미지는 표시<br/>①을 다시 생성하면 ②③④ 초기화" .-> D2
    H2 -. "②를 다시 고르거나 고치면 ③은 유지<br/>카피가 바뀐 Pod의 이미지는 표시, 조립한 ④는 바로 다시 조립<br/>②를 다시 생성하면 ③④ 초기화" .-> D3

    classDef ai fill:#E6F1FF,stroke:#2189FF,color:#0B2A4A
    classDef code fill:#F2F2F2,stroke:#888,color:#222
    classDef human fill:#FFF1E0,stroke:#F08C00,color:#4A2A00,stroke-width:2px
    classDef data fill:#E8F7EC,stroke:#2F9E44,color:#103A1C
    class G1,G2,FIX2,R2,G3,G3b,R3 ai
    class C1,C1b,C2,LOOP,N3,C3,J4 code
    class IN,H1,H2,H3,H4 human
    class S0,D1,D2,D3,D4,OUT data
```

> GitHub, VS Code(Markdown Preview Mermaid Support), Notion에서 그림으로 보인다. 그림이 안 보이는 곳에서는 아래 3·4절의 표가 같은 내용이다.

## 2. 시스템 구성과 데이터 이동

```mermaid
flowchart LR
    U(["🟧 사람<br/>브라우저"]) <-- "화면 조작" --> FE["React 화면<br/>localhost:5173"]
    FE -- "/api/* 요청 (JSON)" --> BE["FastAPI<br/>localhost:8000"]
    BE -- "RunState (JSON)" --> FE
    BE -- "프롬프트 + 변수<br/>JSON 스키마 강제" --> TXT["Vertex AI Gemini<br/>텍스트 gemini-3.5-flash"]
    TXT -- "구조화 JSON" --> BE
    BE -- "P2 프롬프트 + 제품 사진" --> IMG["Vertex AI Gemini<br/>이미지 gemini-3.1-flash-image"]
    IMG -- "PNG" --> BE
    BE <-- "읽기·쓰기" --> FS[("data/app.db (실행 상태)<br/>data/runs/{run_id}/ images/ · html_input.json")]
    BE -- "참조 이미지 읽기" --> PR[("backend/assets/product/<br/>공식 제품 사진")]
```

- 화면은 상태를 따로 들고 있지 않는다. 모든 API가 실행 전체 상태(`RunState`)를 돌려주고, 화면은 그걸 그대로 그린다.
- 주소의 `?run={run_id}`로 새로고침해도 같은 실행을 이어서 본다.
- 모델 없이 확인할 때(`LLM_PROVIDER=mock`, `IMAGE_PROVIDER=placeholder`)는 Vertex 대신 고정 예시와 SVG 자리표시 이미지를 쓴다. 흐름은 같다.

## 3. 단계별 입력 → 출력 → 사람의 선택

| 단계 | 받는 데이터 (어디서) | AI·코드가 하는 일 | 내보내는 데이터 | 사람이 하는 일 |
|---|---|---|---|---|
| 입력 | — | `RunInput` 검증 (스펙이 하나도 없으면 422) | `RunInput` → DB `runs` | 폼 작성 후 시작 |
| ① Pod 순서·레이아웃 | `RunInput` | 방향 3개로 3번 병렬 생성 → `check_pod_plan` | `PodOption` 3안 + 경고 | 1안 선택 / 블록으로 순서·레이아웃 직접 수정 / 수정 요청 넣어 재생성 |
| ② 카피 | `RunInput` + ①에서 **선택한** Pod 순서·레이아웃 | 3번 병렬 생성 → 20자 넘은 헤드만 줄이기 → `check_copy` | `CopyOption` 3안 + 경고 | 1안 선택 / 헤드·바디 직접 수정 / Pod 여러 개(전체) 골라 수정 요청 / 재생성 |
| ③ 이미지 | `RunInput` + ①의 Pod별 레이아웃 + ②에서 **선택한** Pod별 헤드·바디 | Pod마다: 연출안 3개 → 화면비·Safe Zone 고정 → P2 프롬프트 + 제품 사진으로 이미지 생성 → `check_brief` | Pod별 `ImageOption` 3안 (×5 Pod) | Pod마다 1안 선택 / 이미지 한 장 수정 요청(새 안 추가) / 그 Pod만 재생성 |
| ④ 조립 | ①②③에서 **선택한** 결과 전부 | `build_html_input` → Jinja2 템플릿(P3 규칙) | `html_input.json` + 최종 HTML | 미리보기 확인 → ZIP 저장 |

## 4. 단계 사이의 규칙

| 규칙 | 동작 | 이유 |
|---|---|---|
| 앞 단계를 고르기 전엔 다음 단계 생성 불가 | API가 400 | 뒤 단계는 사람이 고른 앞 단계 결과를 전제로 만든다 |
| 앞 단계를 다시 생성하면 뒤 단계 초기화 | `reset_after()`가 뒤 단계와 HTML을 비움. 화면은 먼저 확인창을 띄움 | 고를 안 자체가 새로 바뀐다 |
| 앞 단계를 다시 선택·직접 수정·수정 요청하면 뒤 단계 유지 | `_apply_change()`: ② 카피안의 Pod 순서를 ①에 맞추고, 영향받은 ③ 이미지에 `stale` 표시, 조립된 ④는 다시 조립 | 이미지까지 만든 뒤 조금 고칠 때마다 전부 다시 만들면 시간·비용이 크다. 카피·이미지는 Pod 이름으로 묶여 있어 순서가 바뀌어도 쓸 수 있다 |
| ③은 모든 Pod를 골라야 완료 | 한 Pod라도 비면 ④ 조립 불가 (400) | 최종 시안에 빈 Pod가 생기면 안 된다 |
| 한 실행에서 생성은 한 번에 하나 | 409 | 동시에 돌면 호출이 두 배가 되고 진행 상태를 서로 덮어쓴다 |
| 생성 요청 1분 10회, Vertex 이미지 하루 100장 | 429 / 생성 전에 거절 | 반복 호출·비용 폭주 방지 |
| 3안 중 일부만 실패 | 성공한 안만 보여줌. 모두 실패해야 502 | 한 안의 일시 오류로 단계 전체를 다시 돌리지 않게 |
