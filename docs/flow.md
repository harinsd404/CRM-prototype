# 흐름도

각 단계에서 **AI가 3개 안을 만들고 → 코드가 규칙을 검사하고 → 사람이 하나를 골라(고쳐서) → 고른 결과만 다음 단계로 넘어가는** 구조다.
데이터 형식은 [data-format.md](data-format.md), 실행 방법은 [setup.md](setup.md).

## 1. 전체 흐름

범례: 🟦 AI 생성 · ⬜ 코드 처리 · 🟧 사람이 선택하는 지점 · 🟩 저장되는 데이터 · 실선 화살표 = 데이터 이동 · 점선 = 되돌아가기

```mermaid
flowchart TD
    TPL[("🟩 제품 템플릿 (공유)<br/>제품명·컬러·Pod·사진·제품 규칙 버전")] -- "불러오기" --> IN
    IN[/"🟧 입력 폼<br/>타겟 페르소나 · 소구 강도<br/>제품명 · 컬러 · Pod별 스펙 · 제품 사진"/]
    IN -- "RunInput<br/>POST /api/runs" --> S0[("🟩 실행 생성<br/>DB runs + data/runs/{run_id}/")]

    %% ① Pod 순서·레이아웃
    S0 -- "RunInput" --> G1["🟦 ① Pod 순서·레이아웃 생성<br/>prompts/pod.md × 방향 3개 병렬"]
    G1 -- "PodOption × 3" --> C1["⬜ 규칙 검사 check_pod_plan<br/>모든 Pod·이동 ⌈0.6n⌉개·레이아웃 연속/min(5,⌈0.8n⌉)종"]
    C1 -- "Option × 3 (+warnings)" --> H1{"🟧 사람: ① 선택"}
    H1 -- "다시 생성 (+수정 요청 feedback)" --> G1
    H1 -- "직접 수정: 블록 끌어서 순서·레이아웃 변경" --> C1b["⬜ 같은 규칙으로 재검사"]
    C1b --> H1
    H1 -- "선택 = Pod 순서 + Pod별 L1~L5" --> D1[("🟩 steps.pod.slots.main<br/>selected / edited")]

    %% ② 카피
    D1 -- "RunInput + Pod 순서·레이아웃" --> G2["🟦 ② 카피 생성<br/>prompts/copy.md × 방향 3개 병렬"]
    G2 --> FIX2["🟦 스펙에 없는 과장 표현만 보정 (copy_tone_down.md)<br/>→ 헤드카피 20자·바디카피 110자 초과분만 다시 줄이기<br/>prompts/copy_shorten.md, copy_shorten_body.md"]
    FIX2 -- "CopyOption × 3" --> C2["⬜ 규칙 검사 check_copy<br/>글자 수·헤드 유형·입력에 없는 근거·수치<br/>eyebrow = Pod명으로 고정"]
    C2 -- "Option × 3 (+warnings)" --> H2{"🟧 사람: ② 선택"}
    H2 -- "다시 생성 (+feedback)" --> G2
    H2 -- "수정 요청: Pod 여러 개/전체 + 요청 문장" --> R2["🟦 고른 Pod만 다시 쓰기<br/>prompts/copy_revise.md"]
    R2 --> C2
    H2 -- "직접 수정: 헤드·바디 편집" --> C2
    H2 -- "선택 = Pod별 eyebrow·헤드·바디" --> D2[("🟩 steps.copy.slots.main")]

    %% ③ 이미지 (Pod마다)
    D2 -- "Pod별 레이아웃 + 헤드·바디" --> LOOP["⬜ Pod를 하나씩 차례로 요청<br/>generate?slot={Pod}"]
    LOOP --> G3["🟦 ③-a 이미지 연출안 생성<br/>prompts/image_brief.md 1번 → 서로 다른 3안"]
    G3 -- "ImageBrief" --> N3["⬜ 화면비·Safe Zone을 레이아웃에 맞춤<br/>image_model.md + 제품 규칙에서 필요한 상태만 + 연출안 → 이미지 프롬프트"]
    N3 -- "프롬프트 + 공식 제품 사진" --> G3b["🟦 ③-b 이미지 모델 (안마다 1장)<br/>gemini-3.1-flash-image"]
    G3b -- "ImageOption × 3 (이미지 파일)" --> C3["⬜ 규칙 검사 check_brief<br/>컬러 라인업·L3 금지어·얼굴/손<br/>+ 🟦 완성 이미지 얼굴 판정"]
    C3 --> H3{"🟧 사람: Pod마다 1개 선택"}
    H3 -- "이 Pod만 다시 생성 (+feedback)" --> G3
    H3 -- "이미지 한 장 수정 요청" --> R3["🟦 원본 이미지 + 제품 사진 + 요청<br/>→ 고친 새 안을 추가·선택"]
    R3 --> H3
    H3 -- "선택 = Pod별 이미지 + 화면비" --> D3[("🟩 steps.image.slots.{Pod} × Pod 수<br/>images/*.png")]

    %% ④ 조립
    D3 -- "①②③ 선택 결과" --> J4["⬜ ④ 조립 POST /render<br/>html_input.json(P1 [8] 형식) → Jinja2 템플릿(P3)<br/>LLM 사용 안 함"]
    J4 --> D4[("🟩 RunState.html (DB)<br/>html_input.json")]
    D4 --> H4{"🟧 사람: 미리보기 확인"}
    H4 -- "저장하기" --> OUT[/"ZIP: index.html · images/ · fonts/ · html_input.json"/]
    H4 -- "템플릿으로 저장" --> TPL

    %% 피드백 → 제품 규칙
    H1 & H2 & H3 & H4 -. "직접 남긴 피드백 + 다시 생성·수정 요청 문장" .-> FB[("🟩 피드백 (템플릿별)")]
    FB -- "확인 전 피드백" --> IMP["🟦 제품 규칙 개선안<br/>prompts/improve.md"]
    IMP --> HP{"🟧 사람: 승인 / 거절"}
    HP -- "승인 = 새 버전" --> TPL

    %% 앞 단계 변경
    H1 -. "①을 다시 고르거나 고치면 ②③은 유지<br/>②의 Pod 순서만 따라 맞춤, 화면비가 안 맞는 이미지는 표시<br/>①을 다시 생성하면 ②③④ 초기화" .-> D2
    H2 -. "②를 다시 고르거나 고치면 ③은 유지<br/>카피가 바뀐 Pod의 이미지는 표시, 조립한 ④는 바로 다시 조립<br/>②를 다시 생성하면 ③④ 초기화" .-> D3

    classDef ai fill:#E6F1FF,stroke:#2189FF,color:#0B2A4A
    classDef code fill:#F2F2F2,stroke:#888,color:#222
    classDef human fill:#FFF1E0,stroke:#F08C00,color:#4A2A00,stroke-width:2px
    classDef data fill:#E8F7EC,stroke:#2F9E44,color:#103A1C
    class G1,G2,FIX2,R2,G3,G3b,R3,IMP ai
    class C1,C1b,C2,LOOP,N3,C3,J4 code
    class IN,H1,H2,H3,H4,HP human
    class S0,D1,D2,D3,D4,OUT,TPL,FB data
```

> GitHub, VS Code(Markdown Preview Mermaid Support), Notion에서 그림으로 보인다. 그림이 안 보이는 곳에서는 아래 3·4절의 표가 같은 내용이다.

## 2. 시스템 구성

범례: 🟧 사람 · ⬜ 서버 코드 · 🟦 AI(Vertex) · 🟩 저장소

```mermaid
flowchart TB
    U(["🟧 사용자 브라우저"]) -- "ptk-d2a.insert.team/park" --> CF["Cloudflare<br/>응답이 100초 넘으면 524"]
    CF -- "/park 경로 그대로 전달" --> APP

    subgraph LXC["LXC 1003 ptkorea-d2 (Proxmox insert25) · crm.service :7777"]
        APP["⬜ FastAPI (uvicorn)<br/>BASE_PATH=/park를 떼고 처리"]
        APP -- "화면 파일" --> FE["⬜ frontend/dist<br/>React 빌드 결과"]
        APP --> API
        subgraph API["⬜ /api"]
            direction LR
            A1["auth: 로그인 · 세션 쿠키"]
            A2["runs: 실행 · 생성 · 선택 · 수정 · 조립 · ZIP"]
            A3["templates: 공유 템플릿 · 제품 규칙 버전 · 개선안"]
            A4["feedback: 남기기 · 모아 보기 · CSV"]
            A5["profiles · product-images: 새 제품 규칙 · 사진 검사"]
        end
        API --> GUARD["⬜ steps: AI 호출 (5절)<br/>guard 제한: 생성 1분 10회 · 이미지 하루 100장<br/>실행당 생성 1개씩"]
        API <--> DB[("🟩 data/app.db (SQLite)<br/>users · sessions · runs(RunState)<br/>templates · profile_versions · feedback")]
        API <--> FS[("🟩 data/runs/{run_id}/ images · html_input.json<br/>data/uploads 올린 사진 · assets/product 기본 사진")]
    end

    GUARD -- "프롬프트 + 변수<br/>(JSON 스키마 강제)" --> TXT["🟦 Vertex 텍스트<br/>gemini-3.5-flash"]
    TXT -- "구조화 JSON" --> GUARD
    GUARD -- "이미지 프롬프트 + 제품 사진" --> IMG["🟦 Vertex 이미지<br/>gemini-3.1-flash-image<br/>429가 계속되면 gemini-2.5-flash-image"]
    IMG -- "PNG" --> GUARD

    classDef ai fill:#E6F1FF,stroke:#2189FF,color:#0B2A4A
    classDef code fill:#F2F2F2,stroke:#888,color:#222
    classDef human fill:#FFF1E0,stroke:#F08C00,color:#4A2A00,stroke-width:2px
    classDef data fill:#E8F7EC,stroke:#2F9E44,color:#103A1C
    class TXT,IMG ai
    class APP,FE,API,A1,A2,A3,A4,A5,GUARD,CF code
    class U human
    class DB,FS data
```

- 계정·실행·템플릿·피드백은 서버마다 있는 `app.db`에 있다. git에 올라가지 않아서 로컬과 배포 서버는 서로 다른 데이터를 쓴다.
- 화면은 상태를 따로 들고 있지 않는다. 모든 API가 실행 전체 상태(`RunState`)를 돌려주고, 화면은 그걸 그대로 그린다. 이미지는 한 장씩 끝날 때마다 저장되고, 화면은 생성 중에 실행을 다시 읽어 보여준다.
- 로컬 개발: React 개발 서버(localhost:5173)가 `/api`를 FastAPI(localhost:8000)로 넘긴다. 모델 없이 확인할 때(`LLM_PROVIDER=mock`, `IMAGE_PROVIDER=placeholder`)는 고정 예시와 SVG 자리표시 이미지를 쓴다.

## 3. 단계별 입력 → 출력 → 사람의 선택

| 단계 | 받는 데이터 (어디서) | AI·코드가 하는 일 | 내보내는 데이터 | 사람이 하는 일 |
|---|---|---|---|---|
| 입력 | — | `RunInput` 검증 (스펙이 하나도 없으면 422) | `RunInput` → DB `runs` | 폼 작성 후 시작 |
| ① Pod 순서·레이아웃 | `RunInput` | 방향 3개로 3번 병렬 생성 → `check_pod_plan` | `PodOption` 3안 + 경고 | 1안 선택 / 블록으로 순서·레이아웃 직접 수정 / 수정 요청 넣어 재생성 |
| ② 카피 | `RunInput` + ①에서 **선택한** Pod 순서·레이아웃 | 3번 병렬 생성 → 20자 넘은 헤드·110자 넘은 바디만 줄이기 → `check_copy` | `CopyOption` 3안 + 경고 | 1안 선택 / 헤드·바디 직접 수정 / Pod 여러 개(전체) 골라 수정 요청 / 재생성 |
| ③ 이미지 | `RunInput` + ①의 Pod별 레이아웃 + ②에서 **선택한** Pod별 헤드·바디 | Pod마다: 연출안 3개 → 화면비·Safe Zone 고정 → P2 프롬프트 + 제품 사진으로 이미지 생성 → `check_brief` | Pod별 `ImageOption` 3안 (× Pod 수) | Pod마다 1안 선택 / 이미지 한 장 수정 요청(새 안 추가) / 그 Pod만 재생성 |
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

## 5. AI 호출 상세

AI 호출은 모두 회사 GCP의 Vertex AI로 간다. 텍스트는 `invoke_structured()`가 프롬프트(`backend/app/prompts/*.md`)에 변수를 채워 보내고, 응답은 JSON 스키마로 강제해 받는다. 숫자는 `.env` 기본값이다.

범례: 🟦 AI 호출 · ⬜ 코드 처리 · 🟩 제품 규칙(템플릿) · 점선 = 제품 규칙이 끼워 넣는 내용

```mermaid
flowchart TD
    PROF[("🟩 제품 규칙 (ProductProfile)<br/>pod/copy/visual 가이드 · copy_terms 공식 표기<br/>device_rules 기기 묘사 · states 제품 상태 · photos 사진 자리")]

    subgraph COMMON["⬜ 텍스트 호출 공통 (invoke_structured)"]
        direction LR
        P0["prompts/*.md<br/>## system / ## human"] --> V0["변수 채우기"] --> M0["🟦 gemini-3.5-flash<br/>thinking low · temperature 0.9"] --> J0["JSON 스키마 검증"]
        J0 -- "실패·45초 초과" --> RT0["⬜ 다시 시도 (최대 3번, 5초·10초 뒤)"] --> M0
    end

    subgraph S1["① Pod 순서·레이아웃"]
        P1["🟦 pod.md × 3 병렬<br/>방향: 관심사 우선 · 소구 강도 · 구매 결정 흐름"] -- "PodOption" --> K1["⬜ check_pod_plan"]
    end

    subgraph S2["② 카피"]
        P2["🟦 copy.md × 3 병렬<br/>방향: 직설 · 사용 장면 · 고객 효익"] -- "CopyOption" --> SH["🟦 넘친 것만 줄이기 (최대 2번)<br/>copy_shorten.md 헤드 20자<br/>copy_shorten_body.md 바디 110자<br/>(헤드·바디 동시에)"]
        SH --> KF["⬜ 수치·'기준' 조건이 빠졌으면 줄인 결과 버림"] --> K2["⬜ check_copy<br/>글자 수 · 헤드 유형 분포 · 입력에 없는 근거·수치"]
        RV2["🟦 copy_revise.md<br/>고른 Pod들만 한 번에 다시 쓰기"] --> SH
    end

    subgraph S3["③ 이미지 (Pod 하나 요청마다)"]
        B3["🟦 image_brief.md 1번 호출<br/>→ 서로 다른 연출안 3개<br/>(제품 단독·손 / 인물 사용 장면 / 배경 연출)"]
        B3 -- "ImageBrief × 3" --> NB["⬜ normalize_brief<br/>레이아웃에 맞는 화면비 · Safe Zone<br/>제품 상태 key · 인물 없음 처리 · 헥스 제거"]
        NB --> BP["⬜ build_image_prompt<br/>image_model.md 골격 + 이 상태에 필요한 규칙만<br/>+ 컬러 헥스 + 카피 맥락"]
        NB --> REF["⬜ reference_images<br/>그 상태의 사진 자리 + 컬러 사진"]
        BP & REF --> IM["🟦 gemini-3.1-flash-image × 3<br/>동시 요청 수 = IMAGE_CONCURRENCY<br/>장당 최대 120초"]
        IM -- "429" --> W429["⬜ 5초·15초 기다렸다 다시"] --> IM
        W429 -- "계속 429" --> FB3["🟦 gemini-2.5-flash-image<br/>10분 동안 이 모델 사용"]
        IM & FB3 -- "PNG (끝나는 대로 저장)" --> K3["⬜ check_brief<br/>컬러 라인업 · L3 금지어 · 얼굴/손"]
        ED["🟦 이미지 수정 요청<br/>원본 이미지 + 제품 사진 + 요청 + edit_rules"] --> K3
    end

    subgraph SP["제품 규칙 만들기·고치기"]
        PG["🟦 profile.md<br/>제품 정보 + 사진 최대 10장(긴 변 1024px로 줄임)<br/>→ 사진 자리 · 기기 묘사 · 제품 상태"] --> PK["⬜ 규격 검사 · 사진 부족 경고<br/>(사진 해상도·장 수 검사는 AI 없이 코드로)"]
        IP["🟦 improve.md<br/>확인 전 피드백 최근 60개 + 지금 규칙<br/>→ 개선안 + 반영한 피드백 id"] --> HP2{"🟧 사람 승인"}
    end

    PROF -. "pod_guide" .-> P1
    PROF -. "copy_guide · copy_terms" .-> P2
    PROF -. "copy_guide · copy_terms" .-> RV2
    PROF -. "visual_guide · 상태 목록" .-> B3
    PROF -. "device_rules · 상태별 규칙" .-> BP
    PROF -. "photos" .-> REF
    PROF -. "edit_rules" .-> ED
    PK -- "새 템플릿의 규칙" --> PROF
    HP2 -- "새 버전" --> PROF

    K1 -- "사람이 고른 순서·레이아웃" --> P2
    K2 -- "사람이 고른 카피" --> B3

    classDef ai fill:#E6F1FF,stroke:#2189FF,color:#0B2A4A
    classDef code fill:#F2F2F2,stroke:#888,color:#222
    classDef human fill:#FFF1E0,stroke:#F08C00,color:#4A2A00,stroke-width:2px
    classDef data fill:#E8F7EC,stroke:#2F9E44,color:#103A1C
    class M0,P1,P2,SH,RV2,B3,IM,FB3,ED,PG,IP ai
    class P0,V0,J0,RT0,K1,KF,K2,NB,BP,REF,W429,K3,PK code
    class HP2 human
    class PROF data
```

| 호출 | 프롬프트 | 한 번 생성에 부르는 횟수 | 결과 스키마 | 호출 뒤 코드가 하는 일 |
|---|---|---|---|---|
| ① Pod 순서·레이아웃 | `pod.md` | 3번 (방향마다, 병렬) | `PodOption` | `check_pod_plan` |
| ② 카피 | `copy.md` | 3번 (병렬) + 넘친 안마다 줄이기 최대 2번씩 | `CopyOption` | 줄인 결과의 수치·조건 확인 → `check_copy` |
| ② 카피 수정 | `copy_revise.md` | 1번 (고른 Pod 전부) + 줄이기 | `RevisedPods` | 같은 검사 |
| ③ 연출안 | `image_brief.md` | Pod마다 1번 (3안을 한 번에, 안끼리 겹치지 않게) | `ImageBriefs` | 없는 제품 상태면 실패 처리 → `normalize_brief` |
| ③ 이미지 | `image_model.md` 골격 + 제품 규칙 | Pod마다 3장 | PNG | 끝나는 대로 저장 → `check_brief` |
| ③ 이미지 수정 | 코드 안 편집 프롬프트 + `edit_rules` | 요청마다 1장 | PNG | 새 안으로 추가·선택 |
| 새 제품 규칙 | `profile.md` (사진 입력) | 1번 | `ProductProfile` | 규격 검사·사진 부족 경고 |
| 규칙 개선안 | `improve.md` | 1번 | `ProposalDraft` | 승인 전까지 쓰지 않음, 승인하면 반영한 피드백을 "반영함"으로 |

- ④ 조립과 사진 검사(`image_check.py`)는 AI를 쓰지 않는다.
- 각 단계의 3안 중 일부만 실패하면 성공한 안만 보여준다. 모두 실패해야 오류가 난다.
