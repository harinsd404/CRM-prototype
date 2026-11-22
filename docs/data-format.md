# 데이터 형식 정의서

입력 → 각 단계 출력 → 사람의 선택 결과 → 최종 산출물의 형식을 정리한다.
모든 형식은 백엔드의 Pydantic 모델이 기준이고, 프론트의 `frontend/src/types.ts`가 같은 모양을 따른다.
예시는 실제 실행 기록(`20261027-091857-365eae`, 타겟 "쇼핑, 패션" · HOT)에서 가져왔다. 흐름은 [flow.md](flow.md).

| 구분 | 형식 | 정의 위치 |
|---|---|---|
| 입력 | `RunInput` | `backend/app/core/state.py` |
| 단계 공통 틀 (안·선택 결과) | `Option` / `SlotState` / `StepState` / `RunState` | `backend/app/core/state.py` |
| ① 출력 | `PodOption` | `backend/app/steps/pod.py` |
| ② 출력 | `CopyOption` | `backend/app/steps/copy.py` |
| ③ 출력 | `ImageOption` (+ `ImageBrief`) | `backend/app/steps/image.py` |
| 사람의 선택·수정 요청 | `SelectRequest` / `ReviseRequest` / `GenerateRequest` | `backend/app/api/runs.py` |
| ④ 출력 | `html_input.json` + HTML + ZIP | `backend/app/core/render.py` |

---

## 0. 공통 값 (도메인 상수)

`backend/app/core/domain.py`

| 이름 | 값 | 설명 |
|---|---|---|
| Pod 이름 | string (최대 30자) | 템플릿·입력마다 다르다 (Fold 기본 템플릿: `디자인` `디스플레이` `성능` `카메라` `Now nudge`). `RunInput.pods` 순서가 기본 순서. 한 실행에 최대 10개 |
| `Layout` | `L1` ~ `L5` | 아래 표 |
| `Mood` | `HOT` `WARM` `COLD` | 소구 강도 (원본 P1에서는 "무드") |
| `Ratio` | `1:1` `4:3` `16:9` | 이미지 화면비 |

| 레이아웃 | 모양 | 허용 화면비 (첫 번째가 기본) |
|---|---|---|
| L1 | 텍스트 중앙 정렬(상) + 풀폭 이미지(하) | 16:9, 4:3 |
| L2 | 풀폭 이미지(상) + 좌측 정렬 텍스트(하) | 16:9, 4:3 |
| L3 | 풀블리드 이미지 + 하단 텍스트 오버레이 (텍스트가 이미지 위) | 16:9 |
| L4 | 둥근 이미지 카드 + 하단 텍스트 | 4:3, 1:1 |
| L5 | 2단 분할: 좌측 텍스트 / 우측 이미지 | 4:3, 1:1 |

---

## 1. 입력 — `RunInput`

`POST /api/runs`의 body. 화면의 입력 폼이 이 형식으로 보낸다.

| 필드 | 타입 | 필수 | 설명 · 제약 |
|---|---|---|---|
| `target_id` | string | – (기본 `"P1"`) | 타겟 구분. 최종 이미지 파일명(`P1_1_design.png`)에 쓰인다 |
| `persona` | string | ✔ | 타겟 페르소나(관심사). 빈 문자열 불가 |
| `mood` | `Mood` | ✔ | 소구 강도 |
| `template_id` | int \| null | – | 불러온 제품 템플릿 id (없으면 직접 입력) |
| `product_name` | string | ✔ | 공식 제품명. 영문명이 있으면 영문(Galaxy Z Fold8), 없으면 한국어 공식명(양문형 냉장고 846L). 모델 코드는 쓰지 않는다 (가져오기에서 모델 코드 모양이면 경고) |
| `colors` | string | ✔ | 컬러 라인업, 쉼표로 구분. 이름 뒤에 헥스를 선택으로 붙인다 (`라벤더 #C8B6E2, 그라파이트`). 프롬프트 [입력 데이터]·카피 검사에는 이름만 쓰고, 헥스는 ③ 이미지 모델에 '기준 톤'으로 넘긴다 (장면 조명·배경에 맞춰 조금 달라져도 됨, `state.py parse_colors`). ③에서 제품 색은 이 이름 중 하나여야 한다 |
| `pods` | `PodInput[]` | ✔ | 이번에 쓰는 Pod, **기본 순서대로** 1~10개. 이름·영문 이름이 겹치면 422. 스펙은 **하나 이상 내용이 있어야 함** (없으면 422) |
| `pods[].name` | string | ✔ | Pod 이름. eyebrow와 ③ 슬롯 이름으로 그대로 쓴다 |
| `pods[].key` | string | – | 영문 이름(소문자·숫자·`_`·`-`). 최종 이미지 파일명(`P1_1_design.png`)에 쓴다. 비우면 `pod1`, `pod2` … |
| `pods[].spec` | string | – | Pod별 스펙(Fact). 카피의 팩트체크 근거는 이 원문과 대조된다 |
| `pods[].visual` | string | – | ③ 이미지 기본 연출 방향 |
| `product_images` | `{자리: string \| null}` | – (기본 `{}`) | 공식 제품 사진을 바꾸거나 지운 자리만. 자리 = 제품 프로필의 `photo_slots[].key` (Fold: `closed_front` · `closed_back` · `closed_views` · `unfolded` · `color_lineup`). 없는 자리 = `assets/product`의 기본 사진(`profile`이 없을 때만), `null` = 지움, 문자열 = `POST /api/uploads`가 돌려준 파일 이름. 실행을 만들 때 `data/runs/{run_id}/product/`로 복사해 ③에서 쓴다 |
| `profile` | `ProductProfile` \| null | – | 제품 프로필(프롬프트의 제품별 블록, 아래). 템플릿에서 불러오거나 AI가 사진으로 만든다. null이면 Galaxy Z Fold 프로필 |
| `extra_product_images` | string[] | – (기본 `[]`) | 사진 자리 외에 더 올린 제품 사진(다른 각도·디테일). `POST /api/uploads`의 파일 이름, **최대 5장** (넘으면 422). `product/extra_1.jpg …`로 복사해 ③에서 ① 사진 뒤에 보조 참조로 보낸다 |

입력 화면에서 템플릿을 고르면 템플릿의 기본 이미지로 `product_images`(모든 자리, 템플릿에 없는 자리는 `null`)와 `extra_product_images`를 채운다.
`POST /api/product-images/check`는 같은 두 값을 받아 해상도(긴 변 1000px 미만)·필수 자리(접은 앞면·뒷면·펼친 상태)·장 수(4장 미만)를 검사해 경고만 돌려준다 (AI 없이 코드로).
`POST /api/runs/{id}/template`(`{template_id?, name?}`)은 실행의 제품명·컬러·Pod·제품 사진을 새 템플릿으로 저장하거나 덮어쓴다. 덮어쓸 때 이번 실행에서 쓰지 않은 Pod는 꺼진 채로 남긴다.

```json
{
  "target_id": "P1",
  "persona": "쇼핑, 패션",
  "mood": "HOT",
  "product_name": "Galaxy Z Fold",
  "colors": "라벤더, 그라파이트, 크림, 피스타치오",
  "template_id": 1,
  "pods": [
    { "name": "디자인", "key": "design", "spec": "201g, 펼친 두께 4.5mm, … 코닝® 고릴라® 글래스", "visual": "제품 단독 또는 한 손에 쥔 클로즈업" },
    { "name": "디스플레이", "key": "display", "spec": "커버 10:16 비율, 메인 4:3 비율, 3,000nits, …", "visual": "펼친 화면으로 콘텐츠 감상" },
    { "name": "성능", "key": "performance", "spec": "갤럭시용 스냅드래곤® 8 Elite 5세대, 4,800mAh, …", "visual": "작업 또는 이동 중 장면" },
    { "name": "카메라", "key": "camera", "spec": "후면 50MP 광각 + 50MP 초광각, …", "visual": "접은 상태를 가로로 쥐고 촬영하는 장면" },
    { "name": "Now nudge", "key": "nudge", "spec": "Galaxy AI 기능. 흐름을 끊지 않고 먼저 제안. …", "visual": "일상 상황 속 인물(얼굴 비노출)" }
  ]
}
```

LLM에는 이 JSON 대신 아래처럼 바꾼 `[입력 데이터]` 블록이 모든 단계 프롬프트에 들어간다 (`RunInput.format()`).

```text
- 타겟 페르소나 : 쇼핑, 패션
- 소구 강도(무드) : HOT
- 제품명 : Galaxy Z Fold
- 컬러 라인업 : 라벤더, 그라파이트, 크림, 피스타치오
- Pod별 스펙(Fact) :
  - 디자인 : 201g, 펼친 두께 4.5mm, ...
  - 디스플레이 : ...
```

---

## 2. 단계 공통 틀 — 안과 선택 결과

모든 단계는 같은 틀에 담긴다. **단계(Step) → 슬롯(Slot) → 안(Option)** 구조다.

- ①②는 슬롯이 하나(`"main"`), ③은 Pod마다 슬롯이 하나(`"디자인"`, `"카메라"` …).
- 슬롯마다 AI가 만든 안 N개(기본 3)가 있고, 사람은 그중 하나를 고른다.

### `Option` — AI가 만든 안 하나

| 필드 | 타입 | 설명 |
|---|---|---|
| `angle` | string | 이 안을 만들 때 준 방향. 수정 요청이 있었으면 `"… · 요청: …"`, 이미지 수정안이면 `"1번 수정 · {요청}"` |
| `content` | object | 단계별 출력. ① `PodOption`, ② `CopyOption`, ③ `ImageOption` |
| `warnings` | string[] | 코드가 검사한 규칙 위반. 빈 배열이면 위반 없음. 사람이 보고 판단한다 |

### `SlotState` — 선택 결과

| 필드 | 타입 | 설명 |
|---|---|---|
| `options` | `Option[]` | 생성된 안 목록 |
| `selected` | int \| null | **사람이 고른 안의 번호(0부터)**. null이면 아직 안 고름 |
| `edited` | `Option` \| null | 고른 안을 사람이 직접 고치거나 카피 수정 요청으로 고친 경우의 수정본. 있으면 다음 단계는 원안 대신 이걸 쓴다 |
| `pending` | int | 아직 만드는 중인 안의 수 (이미지는 한 장씩 끝나는 대로 `options`에 붙는다) |
| `stale` | string[] | 이 안들을 만든 뒤 앞 단계에서 바뀐 점 (③ 이미지: 카피 변경, 레이아웃과 화면비·Safe Zone 불일치). 다시 생성하거나 `POST /api/runs/{id}/steps/image/slots/{Pod}/keep`으로 비운다 |
| `failures` | string[] | 이번 생성에서 끝내(3번 시도) 실패한 안의 이유 (예 `안 2: 모델 사용량 초과(429) — 잠시 뒤 다시 생성`, `안 3: 이미지가 생성되지 않았습니다: … (안전 필터나 연출 문제일 수 있음)`). 다시 생성하면 비워진다. 서버 로그에도 남는다 |

다음 단계로 넘어가는 값은 `edited ?? options[selected]`의 `content`다.

### `StepState` / `RunState` — 실행 전체 상태

모든 API가 이 `RunState`를 그대로 돌려주고, DB(`data/app.db`)의 `runs.state`에도 이 모양(JSON)으로 저장된다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | `YYYYMMDD-HHMMSS-{6자리 hex}` |
| `created_at`, `updated_at` | ISO 8601 | |
| `input` | `RunInput` | 1절 |
| `steps` | `{"pod"\|"copy"\|"image": {"slots": {슬롯명: SlotState}}}` | 단계별 상태. 아직 생성 전이면 `slots`가 빈 객체 |
| `html` | string \| null | ④ 조립 결과. 앞 단계를 다시 생성하면 null, 고치기만 하면 바로 다시 조립 |
| `job` | `Job` \| null | 서버에서 도는 생성·수정 작업 `{id, kind: generate\|revise, step, slot, started_at, error}`. 끝나면 null, 끝내 실패하면 `error`가 남는다 (다음 작업이 덮어씀). 서버가 재시작되면 돌던 작업은 "중단됨" 오류로 정리된다 (정상 종료 때 작업이 취소되면 그 자리에서 오류·pending 해제·이미지 원래 안 복원, 강제 종료면 다음 시작 때 `clear_unfinished_jobs`) |

**생성·수정은 백그라운드 작업이다.** `POST …/generate`·`POST …/revise`는 검사(선행 단계·슬롯·요청 한도·이미지 한도)만 하고 `job`을 기록한 실행을 바로 돌려준다.
화면은 `GET /api/runs/{id}`를 2초마다 읽어 `job.id`가 바뀌거나 사라지면 끝, `job.error`가 있으면 실패로 본다 (`frontend/src/api.ts waitForJob`).
이미지 한 Pod가 429 대기까지 겹치면 2분을 넘겨, 요청이 끝날 때까지 기다리면 Cloudflare가 100초에서 끊었다(524, 버즈4 프로 QA에서 Pod 7개 중 5개).
한 실행에 작업은 하나만 돈다 (작업 중 또 생성·수정하면 409). 선택·직접 수정·그대로 쓰기는 작업 중에도 바로 된다.

```json
{
  "id": "20261027-091857-365eae",
  "created_at": "2026-10-27T09:18:57.910576",
  "updated_at": "2026-10-27T12:28:55.256284",
  "input": { "...": "1절의 RunInput" },
  "steps": {
    "pod":   { "slots": { "main":     { "options": ["Option × 3"], "selected": 2, "edited": null } } },
    "copy":  { "slots": { "main":     { "options": ["Option × 3"], "selected": 0, "edited": null } } },
    "image": { "slots": {
      "디자인":     { "options": ["Option × 3"], "selected": 1, "edited": null },
      "디스플레이": { "options": ["Option × 1"], "selected": 0, "edited": null },
      "카메라":     { "options": ["Option × 3"], "selected": 2, "edited": null },
      "성능":       { "options": ["Option × 2"], "selected": 0, "edited": null },
      "Now nudge":  { "options": ["Option × 1"], "selected": 0, "edited": null }
    } }
  },
  "html": "<!doctype html>..."
}
```

> 안 개수가 3보다 적은 슬롯은 일부 안이 생성에 실패한 경우다. 성공한 안만 보여주고, 모두 실패했을 때만 오류가 난다.

---

## 3. ① 출력 — `PodOption` (Pod 순서·레이아웃)

| 필드 | 타입 | 설명 · 규칙 |
|---|---|---|
| `target_summary` | string | 타겟 요약 한두 문장 |
| `items` | `PodPlanItem[]` | **노출 순서대로** 모든 Pod가 한 번씩 |
| `items[].pod` | string | 입력 Pod 이름 그대로. 없는 이름이면 그 안을 다시 생성하고, 사람이 고친 내용이면 422 |
| `items[].layout` | `Layout` | |
| `items[].reason` | string | 이 순위에 둔 근거 |
| `rationale` | string | 순서·레이아웃 조합의 기획 의도 |

코드 검사 (`check_pod_plan` → `warnings`): 모든 Pod가 한 번씩인가 · 기본 순서 대비 위치가 바뀐 Pod가 ⌈0.6n⌉개 이상인가 · 인접한 Pod에 같은 레이아웃이 없는가 · 레이아웃을 min(5, ⌈0.8n⌉)종 이상 썼는가. n = Pod 수, 5개면 원본 규칙(3개 · 4종)과 같다 (`domain.py pod_rules`).

```json
{
  "angle": "구매 결정까지의 흐름(관심 → 확신 → 행동)을 따르는 구성",
  "content": {
    "target_summary": "쇼핑과 패션에 관심이 많고, 트렌디하고 감각적인 스타일을 중시하는 타겟입니다.",
    "items": [
      { "pod": "디자인", "layout": "L3", "reason": "쇼핑, 패션 타겟의 시각적 감성을 자극하기 위해 201g, 펼친 두께 4.5mm 및 세련된 컬러 라인업을 보여주는 디자인을 1순위로 배치합니다." },
      { "pod": "디스플레이", "layout": "L1", "reason": "패션 스타일과 쇼핑 아이템을 시원하게 감상할 수 있는 갤럭시 폴드 시리즈 사상 가장 평평하게 펼쳐짐 및 커버 10:16, 메인 4:3 비율의 디스플레이를 2순위로 보여줍니다." },
      { "pod": "카메라", "layout": "L5", "reason": "자신의 패션과 쇼핑 전후 모습을 고화질로 기록할 수 있는 후면 50MP 광각 및 ProVisual Engine 실시간 노이즈 저감의 카메라 성능으로 관심에서 확신으로 이어지게 합니다." },
      { "pod": "성능", "layout": "L2", "reason": "오랜 쇼핑 중에도 끊김 없는 고성능을 보장하는 갤럭시용 스냅드래곤® 8 Elite 5세대 및 4,800mAh 대용량 배터리 성능을 배치하여 기능적 신뢰를 더합니다." },
      { "pod": "Now nudge", "layout": "L4", "reason": "쇼핑 흐름을 끊지 않고 분할 화면 전환 및 앱 전환 없는 사진 공유를 지원하는 Galaxy AI 기능으로 최종 구매 행동을 유도합니다." }
    ],
    "rationale": "쇼핑 및 패션 타겟의 시선을 즉각 사로잡을 수 있도록 '디자인'을 가장 몰입감 높은 L3 레이아웃으로 1순위에 배치했습니다. (…) 인접한 Pod 간에는 레이아웃(L3-L1-L5-L2-L4)이 중복되지 않도록 교차 배치했습니다."
  },
  "warnings": ["기본 순서 대비 위치가 바뀐 Pod가 2개입니다 (최소 3개)."]
}
```

> 이 안은 경고가 있었지만 사람이 그대로 골랐다. 경고는 막는 장치가 아니라 판단 근거다.

---

## 4. ② 출력 — `CopyOption` (카피)

| 필드 | 타입 | 설명 · 규칙 |
|---|---|---|
| `pods` | `PodCopy[]` | ①에서 고른 순서와 같은 순서로 모든 Pod |
| `pods[].pod` | string | ①의 Pod 이름 그대로 |
| `pods[].eyebrow` | string | Pod명 그대로. **코드가 강제로 맞춘다** |
| `pods[].headline` | string | 헤드카피. 공백 포함 **20자 이내**, 1줄. 넘으면 코드가 모델에게 다시 줄이게 하고, 그래도 넘으면 경고 |
| `pods[].headline_type` | `a`~`e` | 헤드카피 구조 유형. **min(5, ⌈0.8n⌉)종 이상, 같은 유형 max(2, ⌈n/5⌉)회 이하** (5개면 4종 · 2회) |
| `pods[].body` | string | 바디카피. 2~3문장, 공백 포함 **110자 이내** |
| `pods[].ending_order` | string | 바디 문장 어미 배열 (예 `습니다→죠→보세요`). Pod끼리 겹치면 경고 |
| `pods[].factcheck` | `{expression, source}[]` | 카피 표현과 그 근거가 된 **입력 스펙 원문 구절**. `source`가 그 Pod 스펙(+제품명·컬러)에 실제로 없으면 경고 |
| `pods[].target_scene` | string | 바디카피에 넣은 타겟 페르소나의 사용 장면 구절 (예 `등굣길 버스 안에서`). 비었거나 바디에 그대로 없으면 경고. 줄이기·보정 때 빠지면 그 결과를 버린다. ③ 연출안이 이 장면을 우선 쓴다 |
| `rationale` | string | 카피 소구 기획 의도 |

**조건이 붙은 수치 검사** (`missing_conditions`): 스펙에서 수치 바로 앞(쉼표·괄호 뒤부터)에 조건(…사용 시, …기준, …모델, ON/OFF)이 있으면, 카피의 그 수치가 있는 문장(헤드카피는 바디 어디든)에 조건의 핵심 단어가 있어야 한다.
예: 스펙 `최대 6시간(충전 케이스와 함께 사용 시 최대 26시간)`인데 `ANC ON 기준 최대 26시간` → `26 (스펙 조건: 충전 케이스)` 경고. 과장 표현과 함께 자동 보정 대상이다.

**과장·성능 표현 검사** (`unsourced_claims`): 최상급(압도적·최고·완벽·가장…), 무결 주장(끊김·지연·걱정 없이), 지속 시간(하루 종일·밤새), 성능 정도(빠른·매끄러운·정밀한·든든한…), 의료 효능(진단·치료·예방)은 그 Pod 스펙에 같은 어간이 있을 때만 통과한다.
생성·수정 직후 걸린 Pod만 `prompts/copy_tone_down.md`로 한 번 보정하고(수치·조건·타겟 장면이 빠지거나 표현이 줄지 않으면 버림), 그다음 글자 수를 줄인다. 남은 것은 경고.

헤드카피 유형: (a) 쉼표로 두 마디 연결 · (b) 단문 선언 · (c) 수치를 주어로 · (d) 명사형 종결 · (e) 대비 구조

```json
{
  "angle": "기능명과 수치를 앞세우는 직설적인 카피",
  "content": {
    "pods": [
      {
        "pod": "디자인", "eyebrow": "디자인",
        "headline": "201g이 만드는 휴대성", "headline_type": "c",
        "body": "201g의 무게와 4.5mm 두께로 가벼움을 선사합니다. 플렉스 티타늄의 단단함이 더해졌죠. 직접 들어보세요.",
        "ending_order": "습니다→죠→보세요",
        "factcheck": [
          { "expression": "201g의 무게", "source": "201g" },
          { "expression": "4.5mm 두께", "source": "펼친 두께 4.5mm" },
          { "expression": "플렉스 티타늄", "source": "플렉스 티타늄" }
        ]
      },
      {
        "pod": "디스플레이", "eyebrow": "디스플레이",
        "headline": "완벽에 가깝게 평평한 화면", "headline_type": "d",
        "body": "폴드 사상 가장 평평하게 펼쳐지는 193.2mm 화면을 소개합니다. 3,000nits 밝기로 야외에서도 선명하죠. 화면에 몰입해 보세요.",
        "ending_order": "합니다→죠→보세요",
        "factcheck": [
          { "expression": "가장 평평하게 펼쳐지는", "source": "갤럭시 폴드 시리즈 사상 가장 평평하게 펼쳐짐" },
          { "expression": "193.2mm 화면", "source": "펼친 상태 193.2mm 화면" },
          { "expression": "3,000nits 밝기", "source": "3,000nits" }
        ]
      },
      {
        "pod": "카메라", "eyebrow": "카메라",
        "headline": "50MP로, 더 선명하게", "headline_type": "a",
        "body": "50MP 광각 카메라로 일상의 패션을 생생하게 담아보세요. ProVisual Engine이 노이즈를 실시간으로 줄여줍니다. 아주 밤에도 완벽하죠.",
        "ending_order": "보세요→습니다→죠",
        "factcheck": [
          { "expression": "50MP 광각 카메라", "source": "후면 50MP 광각" },
          { "expression": "ProVisual Engine", "source": "ProVisual Engine" },
          { "expression": "실시간으로 줄여줍니다", "source": "실시간 노이즈 저감" }
        ]
      },
      {
        "pod": "성능", "eyebrow": "성능",
        "headline": "하루를 채우는 4,800mAh", "headline_type": "b",
        "body": "4,800mAh 대용량 배터리로 최대 26시간 연속 재생이 가능합니다. 초고속 성능의 스냅드래곤® 8 Elite 5세대도 탑재되었죠. 자유롭게 경험해 보세요.",
        "ending_order": "합니다→죠→보세요",
        "factcheck": [
          { "expression": "4,800mAh 대용량 배터리", "source": "4,800mAh" },
          { "expression": "최대 26시간 연속 재생", "source": "연속 재생 하루 최대 26시간" },
          { "expression": "스냅드래곤® 8 Elite 5세대", "source": "스냅드래곤® 8 Elite 5세대" }
        ]
      },
      {
        "pod": "Now nudge", "eyebrow": "Now nudge",
        "headline": "흐름을 끊지 않는 스마트함", "headline_type": "d",
        "body": "Galaxy AI가 흐름을 끊지 않고 제안합니다. 알림을 누르면 즉시 분할 화면으로 전환되죠. 편리한 멀티태스킹을 만나보세요.",
        "ending_order": "합니다→죠→보세요",
        "factcheck": [
          { "expression": "Galaxy AI", "source": "Galaxy AI" },
          { "expression": "흐름을 끊지 않고 제안합니다", "source": "흐름을 끊지 않고 먼저 제안" },
          { "expression": "분할 화면으로 전환", "source": "알림을 누르면 분할 화면으로 전환" }
        ]
      }
    ],
    "rationale": "쇼핑과 패션에 관심이 많은 타겟의 취향에 맞춰, 가볍고 슬림한 디자인과 야외에서도 선명한 디스플레이, 디테일한 50MP 카메라 촬영 성능을 직설적이고 감각적인 HOT 톤앤매너로 전달하고자 하였습니다."
  },
  "warnings": ["어미 배열이 같은 Pod가 있습니다."]
}
```

---

## 5. ③ 출력 — `ImageOption` (Pod별 이미지)

Pod마다 슬롯이 하나씩 있고, 슬롯마다 아래 안이 3개씩 생긴다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `brief` | `ImageBrief` | LLM이 쓴 이미지 연출안 (원본 P1의 "이미지 Input Data") |
| `prompt` | string | 이미지 모델에 실제로 보낸 프롬프트 = P2 원문(`prompts/image_model.md`) + 아래 연출안 블록 |
| `image_url` | string | 생성된 이미지 주소 `/api/files/{run_id}/images/{8자리}.png` |
| `face_visible` | bool \| null | 예전 실행(얼굴 비노출 정책 때)의 얼굴 판정 결과. 지금은 판정하지 않아 항상 null (읽기 호환용) |
| `product_mismatch` | string \| null | 완성 이미지 속 제품이 그 상태의 주 참조 사진과 다른 모델로 보이면 무엇이 다른지 (텍스트 모델이 두 사진을 비교, 색·조명·각도·열림 정도는 무시하고 형태·특징 부위 개수와 배치만). 있으면 안에 경고. 수정한 안도 판정한다. 냉장고 QA에서 4도어·하냉동형으로 그려진 3장을 잡았다 |

연출안 프롬프트에는 무드별 빛·시간대(`MOOD_GUIDES`: HOT 저녁·네온 / WARM 낮 자연광 / COLD 확산광)와 다른 Pod에서 이미 쓴 장면·컬러(고른 안, 없으면 만든 안 전부)를 넘긴다.
장면이 무드와 맞지 않는 빛(HOT인데 '햇살', '노을' 등)이면 경고.

컬러 참조 사진: 연출안 컬러가 사진 속 기준 컬러(`reference_color`)가 아니면, 라벨에 그 컬러 이름이 들어간 사진 자리(예 `핑크 골드 컬러 라인업`)를 우선 보내고 없으면 `color_slot`을 보낸다.

화면이 보이는 상태면 제품 규칙의 `# Screen` 뒤에 공통 `@screen`(숫자·시각·글자 없이 링·막대·점으로만)을 붙인다. 시계처럼 화면이 작으면 모델이 깨진 숫자를 그리기 쉬워서다.

얼굴은 허용한다 (2026-11-23 결정. 이어폰처럼 귀·얼굴 가까이 쓰는 제품은 얼굴을 피하면 인물 컷을 쓸 수 없었다). 대신 이미지 프롬프트의 `# People and faces`가 인물을 타겟 페르소나의 나이·스타일로, 카메라를 보지 않는 자연스러운 표정으로, 실존 유명인과 닮지 않게 하고, 제품이 또렷한 주인공이 되게 한다.

### `ImageBrief`

| 필드 | 타입 | 설명 · 규칙 |
|---|---|---|
| `concept` | string | 이미지 콘셉트 한 줄 |
| `image_type` | `Base` \| `Hand-held` \| `인물 포함` \| `배경 연출` | |
| `color` | string | 제품 색. 입력 `colors` 중 하나여야 함 (아니면 경고) |
| `state` | `fully closed front` \| `fully closed back` \| `fully unfolded` | 제품 상태. 이 값으로 첨부할 공식 제품 사진이 정해진다 |
| `view` | `straight-on front` \| `straight-on back` \| `straight-on unfolded` | 시점 |
| `scene` | string | 장소, 시간대 |
| `props` | string | 소품 2~3개 |
| `screen_content` | string | 화면 콘텐츠. 글자 없는 추상 UI |
| `person_hand` | string | 인물/손 묘사 또는 `없음` |
| `face` | `visible` \| `hidden` \| `no person` | 얼굴이 보임 / 손·팔이나 뒷모습만 / 사람 없음 (예전 실행은 `hidden`·`no person`만 있음) |
| `composition` | string | 앵글, 제품 점유율 % |
| `ratio` | `Ratio` | **레이아웃의 허용 화면비가 아니면 코드가 기본값으로 고친다** |
| `safe_zone` | string | L3만 "장면 안의 조용한 영역"을 위치와 함께. L3가 아니면 **코드가 `없음 (텍스트는 이미지 외부 배치)`로 고친다**. L3에서 `여백`·`빈 공간`·`패널`·`띠`·`프레임`을 쓰면 경고 |

```json
{
  "angle": "손이나 인물(얼굴 비노출)이 함께 있는 사용 장면",
  "content": {
    "brief": {
      "concept": "한 손에 가볍게 들고 있는 얇고 견고한 갤럭시 Z 폴드의 세련된 모습",
      "image_type": "Hand-held",
      "color": "라벤더",
      "state": "fully closed back",
      "view": "straight-on back",
      "scene": "모던하고 미니멀한 패션 편집숍 내부, 오후의 따뜻하고 강렬한 자연광",
      "props": "가죽 쇼퍼백, 미니멀한 실버 주얼리, 실크 스카프",
      "screen_content": "화면 없음 (접힌 상태의 후면 연출)",
      "person_hand": "한 손으로 가볍게 제품을 쥐고 있는 감각적인 네일 아트가 된 손",
      "face": "hidden",
      "composition": "클로즈업 뷰, 전체 화면 중 제품이 차지하는 비중 약 45%",
      "ratio": "16:9",
      "safe_zone": "하단 45% — 부드럽게 아웃포커싱된 편집숍의 대리석 테이블 표면"
    },
    "prompt": "(P2 원문: prompts/image_model.md)\n\n- Pod : 디자인\n- 타겟 페르소나 : 쇼핑, 패션\n- 레이아웃 : L3 (풀블리드 이미지 + 하단 텍스트 오버레이 — 텍스트가 이미지 위)\n- 이미지 유형 : Hand-held\n- 제품 컬러 : 라벤더\n- 제품 상태 : fully closed back\n- 시점 : straight-on back\n- 장면 : 모던하고 미니멀한 패션 편집숍 내부, 오후의 따뜻하고 강렬한 자연광\n- 소품 : 가죽 쇼퍼백, 미니멀한 실버 주얼리, 실크 스카프\n- 화면 콘텐츠 : 화면 없음 (접힌 상태의 후면 연출)\n- 인물/손 : 한 손으로 가볍게 제품을 쥐고 있는 감각적인 네일 아트가 된 손\n- 얼굴 : hidden\n- 구도 : 클로즈업 뷰, 전체 화면 중 제품이 차지하는 비중 약 45%\n- 소구 강도(무드) : HOT\n- 화면비 : 16:9\n- Text Safe Zone : 하단 45% — 부드럽게 아웃포커싱된 편집숍의 대리석 테이블 표면\n",
    "image_url": "/api/files/20261027-091857-365eae/images/0bababa7.png"
  },
  "warnings": []
}
```

이미지 모델에는 프롬프트와 함께 `backend/assets/product/`의 공식 제품 사진이 참조 이미지로 첨부된다.

| `state` | 첨부하는 사진 (앞이 주 참조) |
|---|---|
| `fully closed front` | `closed_front`, `closed_views` |
| `fully closed back` | `closed_back`, `closed_views` |
| `fully unfolded` | `unfolded` |
| (공통, 있으면) | `color` 가 라벤더가 아니면 `color_lineup`, 그리고 `style_anchor` |

---

## 6. 사람의 선택·수정 결과

사람이 화면에서 하는 행동은 모두 아래 요청 중 하나로 서버에 전달되고, 결과는 2절의 `SlotState`(`selected`, `edited`, `options`)에 저장된다.
앞 단계의 선택이 바뀌면 그 뒤 단계의 `slots`와 `html`은 비워진다.

### 6-1. 안 고르기 — `POST /api/runs/{id}/steps/{step}/select`

| 필드 | 타입 | 설명 |
|---|---|---|
| `slot` | string | ①② `"main"`(기본값), ③ Pod 이름 |
| `index` | int | 고른 안 번호 (0부터) |
| `edited` | object \| null | 사람이 직접 고친 내용. 그 단계의 `content`와 **같은 스키마**여야 함 (틀리면 422). 저장할 때 같은 규칙으로 다시 검사해 `warnings`를 새로 만든다 |

```json
{ "slot": "main", "index": 2, "edited": null }
```

```json
{ "slot": "디자인", "index": 1 }
```

직접 고친 경우 (② 카피, 성능 Pod의 헤드·바디를 고침 — `edited`에는 모든 Pod를 보낸다):

```json
{
  "slot": "main",
  "index": 2,
  "edited": {
    "pods": [
      "… 다른 4개 Pod는 원안 그대로 …",
      {
        "pod": "성능", "eyebrow": "성능",
        "headline": "스냅드래곤® 8 Elite", "headline_type": "d",
        "body": "스냅드래곤® 8 Elite 5세대의 압도적인 성능을 만나 보세요. 연속 재생 하루 최대 26시간의 배터리로 하루 종일 든든하게 레시피를 재생합니다. 방전 걱정 없는 강력함을 지금 확인해 보세요.",
        "ending_order": "보세요→합니다→보세요",
        "factcheck": [
          { "expression": "스냅드래곤® 8 Elite 5세대", "source": "스냅드래곤® 8 Elite 5세대" },
          { "expression": "연속 재생 하루 최대 26시간", "source": "연속 재생 하루 최대 26시간" }
        ]
      }
    ],
    "rationale": "…"
  }
}
```

저장 결과 (`SlotState`):

```json
{
  "options": ["원안 Option × 3 (그대로 남음)"],
  "selected": 2,
  "edited": {
    "angle": "고객 효익을 짧고 선명하게 정리하는 카피",
    "content": { "pods": ["… 고친 모든 Pod …"], "rationale": "…" },
    "warnings": ["[디스플레이] 바디카피 111자 (최대 110자)", "어미 배열이 같은 Pod가 있습니다."]
  }
}
```

### 6-2. 수정 요청 — `POST /api/runs/{id}/steps/{step}/revise`

②와 ③에서만 쓸 수 있다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `slot` | string | ② `"main"`, ③ Pod 이름 |
| `index` | int | 고칠 안 번호 |
| `request` | string | 사람의 수정 요청 (1~500자) |
| `pods` | string[] | ②에서만 필수. 고칠 Pod들 (여러 개 또는 전체) |

② 카피 — 고른 안에서 지정한 Pod만 AI가 다시 쓰고, 결과를 `edited`로 저장한 뒤 그 안을 선택한다.

```json
{ "slot": "main", "index": 0, "request": "더 감성적인 톤으로, 수치는 하나만", "pods": ["성능", "카메라"] }
```

③ 이미지 — 그 이미지와 제품 사진을 함께 보내 요청 부분만 고친 **새 안을 추가**하고 선택한다. 원래 안은 남는다.

```json
{ "slot": "카메라", "index": 0, "request": "휴대폰을 전면으로 바꿔줘" }
```

저장 결과 (`SlotState`, 카메라 슬롯에 수정안이 두 번 추가된 경우):

```json
{
  "options": [
    { "angle": "제품 단독(Base) 또는 한 손에 쥔 클로즈업", "content": { "image_url": "/api/files/20261027-081626-c518b2/images/cafe114e.png", "...": "…" }, "warnings": [] },
    { "angle": "손이나 인물(얼굴 비노출)이 함께 있는 사용 장면", "content": { "image_url": ".../2918586a.png", "...": "…" }, "warnings": [] },
    { "angle": "공간·배경 연출이 돋보이는 장면", "content": { "image_url": ".../e3d7c756.png", "...": "…" }, "warnings": [] },
    { "angle": "1번 수정 · 휴대폰을 전면으로 바꿔줘", "content": { "image_url": ".../44b3f9ab.png", "...": "…" }, "warnings": [] },
    { "angle": "4번 수정 · 전면에 카메라가 있으면 안돼", "content": { "image_url": ".../a879fcd3.png", "...": "…" }, "warnings": [] }
  ],
  "selected": 4,
  "edited": null
}
```

수정안의 `content.prompt`에는 원래 프롬프트 뒤에 `# Revision Request\n{요청}`이 붙는다.

### 6-3. 다시 생성 — `POST /api/runs/{id}/steps/{step}/generate?slot=`

| 위치 | 필드 | 설명 |
|---|---|---|
| query | `slot` | 생략하면 그 단계 전체, ③에서 Pod 이름을 주면 그 Pod만 |
| body | `feedback` | string \| null (최대 500자). 있으면 모든 안의 방향 뒤에 "사람의 수정 요청"으로 붙인다 |

```json
{ "feedback": "배경을 더 밝은 실내로" }
```

결과 안의 `angle`은 `"공간·배경 연출이 돋보이는 장면 · 요청: 배경을 더 밝은 실내로"`처럼 기록된다.

---

## 7. ④ 최종 출력

`POST /api/runs/{id}/render`가 ①②③의 **선택 결과**만 모아 만든다. LLM은 쓰지 않는다.

### 7-1. `html_input.json` (원본 P1 [8] "HTML 합성용 JSON" 형식)

| 필드 | 타입 | 설명 |
|---|---|---|
| `target` | string | `RunInput.target_id` |
| `pods[].order` | int | 노출 순서 (1부터) — ① |
| `pods[].pod`, `eyebrow` | string | Pod명 — ① |
| `pods[].layout` | `Layout` | ① |
| `pods[].img` | string | `{target}_{order}_{Pod 영문명}.png` (design/display/performance/camera/nudge) |
| `pods[].img_ratio` | `Ratio` | ③에서 고른 이미지의 화면비 |
| `pods[].headline`, `body` | string | ②에서 고른(고친) 카피 |
| `pods[].image_url` | string | 미리보기용 실제 이미지 경로 (원본 형식에는 없는 필드) |

```json
{
  "target": "P1",
  "pods": [
    { "order": 1, "pod": "디자인", "eyebrow": "디자인", "layout": "L3", "img": "P1_1_design.png", "img_ratio": "16:9",
      "headline": "201g이 만드는 휴대성",
      "body": "201g의 무게와 4.5mm 두께로 가벼움을 선사합니다. 플렉스 티타늄의 단단함이 더해졌죠. 직접 들어보세요.",
      "image_url": "/api/files/20261027-091857-365eae/images/0bababa7.png" },
    { "order": 2, "pod": "디스플레이", "eyebrow": "디스플레이", "layout": "L1", "img": "P1_2_display.png", "img_ratio": "16:9",
      "headline": "완벽에 가깝게 평평한 화면",
      "body": "폴드 사상 가장 평평하게 펼쳐지는 193.2mm 화면을 소개합니다. 3,000nits 밝기로 야외에서도 선명하죠. 화면에 몰입해 보세요.",
      "image_url": "/api/files/20261027-091857-365eae/images/8874d3f3.png" },
    { "order": 3, "pod": "카메라", "eyebrow": "카메라", "layout": "L5", "img": "P1_3_camera.png", "img_ratio": "4:3",
      "headline": "50MP로, 더 선명하게",
      "body": "50MP 광각 카메라로 일상의 패션을 생생하게 담아보세요. ProVisual Engine이 노이즈를 실시간으로 줄여줍니다. 아주 밤에도 완벽하죠.",
      "image_url": "/api/files/20261027-091857-365eae/images/2cd776c2.png" },
    { "order": 4, "pod": "성능", "eyebrow": "성능", "layout": "L2", "img": "P1_4_performance.png", "img_ratio": "16:9",
      "headline": "하루를 채우는 4,800mAh",
      "body": "4,800mAh 대용량 배터리로 최대 26시간 연속 재생이 가능합니다. 초고속 성능의 스냅드래곤® 8 Elite 5세대도 탑재되었죠. 자유롭게 경험해 보세요.",
      "image_url": "/api/files/20261027-091857-365eae/images/a70eb200.png" },
    { "order": 5, "pod": "Now nudge", "eyebrow": "Now nudge", "layout": "L4", "img": "P1_5_nudge.png", "img_ratio": "4:3",
      "headline": "흐름을 끊지 않는 스마트함",
      "body": "Galaxy AI가 흐름을 끊지 않고 제안합니다. 알림을 누르면 즉시 분할 화면으로 전환되죠. 편리한 멀티태스킹을 만나보세요.",
      "image_url": "/api/files/20261027-091857-365eae/images/ff6c8a35.png" }
  ]
}
```

### 7-2. HTML과 ZIP

- 조립된 HTML은 `RunState.html`에 저장되고 `GET /api/runs/{id}/preview`로 본다. 배경색은 P3 규칙대로 L3는 검정, 나머지는 흰색이되 흰색이 연달아 오면 두 번째를 회색으로 정한다.
- `GET /api/runs/{id}/download`는 서버 없이 열리는 ZIP을 준다. 이미지·폰트 주소를 ZIP 안의 상대 경로로 바꾼다.

```text
crm-20261027-091857-365eae.zip
├── index.html
├── images/            선택된 이미지만
│   ├── 0bababa7.png
│   └── …
├── fonts/             SamsungOneArabic-*.ttf (폰트 파일이 있을 때만)
└── html_input.json
```

---

## 8. 저장 위치

| 경로 | 내용 |
|---|---|
| `backend/data/app.db` (SQLite) | `users`(계정) · `sessions`(로그인) · `templates`·`template_pods`·`template_images`(제품 템플릿과 Pod·기본 이미지, 모두가 함께 씀. 처음 켤 때 Galaxy Z Fold와 `assets/product` 사진을 넣는다. 사진 파일은 `data/uploads/`) · `runs`(실행별 `RunState` 전체를 `state` 칸에 JSON으로, 소유자 `user_id`, 불러온 `template_id`) · `feedback`(피드백, 아래) · `profile_versions`(템플릿의 제품 프로필 버전: active 지금 것 / archived 예전 것 / proposed AI 개선안) |
| `backend/data/runs/{run_id}/product/` | 실행을 만들 때 복사한 제품 사진 |
| `backend/data/runs/{run_id}/images/` | 생성된 이미지 (`.png`, placeholder 모드는 `.svg`) |
| `backend/data/runs/{run_id}/html_input.json` | 7-1 |
| `backend/data/usage.json` | 하루 이미지 호출 수 `{"date": "2026-10-27", "images": 42}` |
| `backend/assets/image_pool/{Pod 영문명}/{16x9 등}_*.png` | `IMAGE_PROVIDER=pool`용 이미지 (`scripts/save_pool.py`로 저장) |

`backend/data/`는 git에 올리지 않는다.

---

## 9. 오류 응답

오류는 FastAPI 형식 `{"detail": "메시지"}`로 온다 (입력 검증 오류 422는 `detail`이 배열).

| 코드 | 언제 | 예 |
|---|---|---|
| 400 | 앞 단계 미선택, 없는 슬롯·안 번호, 미완료 상태에서 조립 | `"먼저 'pod' 단계에서 안을 선택해야 합니다."` |
| 404 | 없는 실행·단계, 조립 전 미리보기 | `"실행을 찾을 수 없습니다: …"` |
| 409 | 같은 실행에서 생성이 이미 진행 중 | `"이 실행은 이미 생성 중입니다. …"` |
| 422 | 입력·수정본이 스키마와 다름, 스펙이 하나도 없음 | `"수정 내용 형식이 맞지 않습니다: …"` |
| 429 | 1분 10회 초과, 하루 이미지 한도 초과 | `"오늘 이미지 생성 한도를 넘습니다 (사용 98장 + 이번 3장 > 한도 100장). …"` |
| 502 | 모델 호출이 (재시도 후에도) 모든 안에서 실패 | `"'image' 생성에 실패했습니다: …"` |


## 피드백 — `feedback` 테이블

만든 CRM에서 마음에 들지 않는 부분. 실행이 불러온 템플릿(`template_id`)별로 모아 프롬프트 개선과 개발자의 로직 개선에 쓴다.

| 칸 | 값 | 설명 |
|---|---|---|
| `step` | `pod` `copy` `image` `result` | 어느 단계에 대한 피드백인지 (`result` = ④ 최종 시안) |
| `pod` | string \| null | 특정 Pod에 대한 것이면 그 이름 |
| `content` | string (최대 1000자) | 피드백 내용 |
| `context` | string | 남길 때 선택돼 있던 결과(Pod 순서, 헤드·바디, 이미지 콘셉트·주소). 코드가 채운다 |
| `source` | `manual` `regenerate` `revise` | 직접 남김 / ①~③ 다시 생성 때 적은 요청 / 카피·이미지 수정 요청 (뒤의 둘은 자동으로 쌓인다) |
| `status` | `open` `applied` `dismissed` | 확인 전 / 반영함 / 보류. 템플릿을 함께 쓰므로 누구나 바꿀 수 있다 |

API: `POST·GET /api/runs/{id}/feedback`(내 실행) · `GET /api/feedback?template_id=&no_template=&status=&source=`(모든 사용자) · `GET /api/feedback/export`(같은 조건, CSV) · `PATCH /api/feedback/{id}`(`{status}`) · `DELETE /api/feedback/{id}`(내가 남긴 것만).


## 제품 프로필 — `ProductProfile`

`backend/app/core/profile.py`. 프롬프트는 **공통 골격**(prompts/*.md: 역할·레이아웃·출력 형식·사진 품질·글자 없음 같은 안전 규칙, 모든 제품이 같음)과
**제품별 블록**(이 규격)으로 나뉜다. Galaxy Z Fold 프로필(`FOLD_PROFILE`)은 지금까지 코드·프롬프트에 박혀 있던 규칙을 그대로 옮긴 것이다.

| 필드 | 언어 | 쓰는 곳 |
|---|---|---|
| `device_noun` | 영어 | 이미지 프롬프트 첫 문장, 연출안 프롬프트 |
| `device_rules` | 영어 | 이미지 프롬프트 `# Device` (몸체 색은 `[제품 컬러]`) |
| `states[]` | key·rules 영어, label·brief_hint 한국어 | 연출안의 `state`, 이미지 프롬프트의 상태 규칙. `shows_screen`·`orientation`은 코드가 연출안을 맞출 때, `photos`(첫 번째 = 주 참조)는 참조 사진 고를 때 |
| `photo_slots[]` | label 한국어, caption 영어 | 입력 화면의 사진 칸, 이미지 모델에 사진과 함께 보내는 설명. `required`·주 참조 자리가 비면 경고 |
| `screen_rules` | 영어 | 화면이 보이는 상태일 때 `# Screen` |
| `usage` | 한국어 | ③ 연출안 프롬프트: 손·인물 장면에서 제품을 쓰는 방식 (손에 쥠 / 손목에 참 / 설치해 두고 문을 엶). 비면 제품 크기에 맞게 쓰라는 기본 문장 |
| `person_rules` | 영어 | 손·인물이 있는 이미지의 `# Hands and people`에 들어가는 제품별 규칙. 비면 같은 기본 문장(영어) |
| `check`, `edit_rules` | 영어 | 이미지 프롬프트 마지막 확인 줄, 이미지 수정 때 지킬 규칙 |
| `reference_color`, `color_slot` | | 사진 속 제품 컬러가 아니면 컬러 라인업 사진도 함께 보낸다 |
| `copy_terms` | 한국어 | ② 카피 프롬프트의 "그대로 쓸 공식 표기" |
| `pod_guide`, `copy_guide`, `visual_guide` | 한국어 | 제품별 가이드. ① Pod 기획 · ② 카피(수정 포함) · ③ 연출안 프롬프트 끝에 "이 제품의 가이드"로 붙는다 (공통 규칙이 우선). 피드백 개선안이 주로 고치는 곳 |

`POST /api/profiles/generate`(`{product_name, colors, pods, images}`)는 올린 사진(최대 10장)과 제품 정보를 Vertex Gemini에 보내 이 규격으로 받는다.
규격(키 형식, 상태가 가리키는 사진 자리)은 코드가 검사해 어기면 다시 생성한다. 사진마다 자리를 배정해 돌려주고(`product_images`, 남는 사진은 `extra_product_images`),
Pod별 기본 연출(`pod_visuals`)과 사진이 부족하거나 흐린 점(`warnings`)도 함께 준다. 주 참조 사진이 없는 상태는 빼고 알린다.

### 삼성닷컴 제품 페이지에서 가져오기

입력 화면의 "삼성닷컴 제품 페이지에서 가져오기". `backend/app/steps/product_page.py`, 프롬프트 `prompts/product_page.md`.

| API | 하는 일 |
|---|---|
| `POST /api/product-pages/import` (`{url, pods}`) | 주소를 따라가 제품 기본 경로를 정하고(모델 주소 `SM-…/`는 구매 페이지로 넘어감) 제품 정보(`/`)·스펙(`specs/`)·구매(`buy/`) 페이지를 받는다. 모든 페이지에 똑같이 있는 연속 6줄 이상(메뉴·팝업)을 지우고, 스펙(최대 3만 자)·구매(8천 자, 스펙 표가 없으면 3만 자) 페이지를 담은 뒤 남은 예산(전체 8만 자)을 제품 정보 페이지에 줘서(버즈처럼 스펙 페이지가 비고 배터리 수치가 제품 정보 페이지 끝 각주에 있는 경우) 글만 Vertex Gemini에 보내 `{product_name, colors, pods[{name, key, spec}]}`로 받는다. `pods`(지금 Pod 이름)를 주면 그 이름별로 스펙을 나누고, 없으면 4~6개를 제안한다(이름은 eyebrow로 쓰이므로 `POD_NAME_MAX` 10자 이내, 넘으면 경고 — 입력 화면의 Pod 칸도 같은 기준으로 표시). 스펙의 수치가 페이지 글에 없으면 `warnings`. 사진 후보 `images[{url, width, height}]`: `images.samsung.com` 이미지 중 아이콘·모바일용·띠 배너·긴 변 600px 미만을 뺀 것(구매 페이지 갤러리 먼저, 최대 60장) |
| `POST /api/product-pages/images` (`{urls}`, 최대 10) | 고른 후보를 받아 올린 사진(`data/uploads`)으로 저장한다. 결과 `[{source, name, url}]`의 `name`은 직접 올린 사진과 똑같이 쓴다 |

- 받는 주소는 `www.samsung.com`만, 리다이렉트는 `*.samsung.com`과 접속 대기열 `*.queue-it.net`만 따라간다 (서버가 대신 받는 주소라 SSRF 방지). 사진은 `images.samsung.com`만.
- 화면은 바로 덮어쓰지 않는다: 미리 보고 "입력에 채우기"를 누르면 제품명·컬러를 바꾸고, 같은 이름의 Pod는 스펙만 바꾼다 (Pod가 없으면 새로 만든다). 가져온 사진은 새 제품이면 'AI로 제품 규칙 만들기' 사진으로, 템플릿을 쓰는 중이면 추가 사진으로 들어간다.

### 템플릿 메뉴 — 프로필 버전과 피드백 개선안

헤더의 **템플릿** 메뉴에서 다룬다 (예전의 '고급 모드' 스위치는 없앴다. 권한 구분은 없다).

| API | 하는 일 |
|---|---|
| `GET /api/templates/{id}/profile/versions` | 버전 목록 (최근 것부터). status: active 사용 중 / archived 예전 / proposed 개선안 / rejected 거절 |
| `PUT /api/templates/{id}/profile` (`{profile, note, base_version}`) | 직접 고친 프로필을 새 active 버전으로 (source=manual). 결과 `{version}`: 정리 후 지금 버전과 같으면 null(만들지 않음). 템플릿 사진이 있는 자리를 지우면 400, `base_version` 뒤로 다른 사람이 바꿨으면 409 |
| `POST /api/templates/{id}/profile/propose` | 이 템플릿의 확인 전 피드백(최근 60건)과 지금 프로필을 Vertex Gemini에 보내 개선안(proposed)을 만든다. 사진 자리 key는 못 바꾸고, 바꿨다고 한 항목이 그대로면 다시 생성한다. 프로필로 고칠 수 없는 피드백은 note에 "개발자 확인"으로 남는다 |
| `POST /api/templates/{id}/profile/versions/{v}/activate` | 개선안 승인 또는 예전 버전으로 되돌리기. 개선안을 승인하면 같은 트랜잭션에서 반영한 피드백을 `applied`로 바꾼다. 개선안을 만든 뒤(`base_version`) 다른 버전이 쓰이게 됐으면 409 (다시 만들어야 함) |
| `POST /api/templates/{id}/profile/versions/{v}/reject` | 개선안 거절 |

입력 화면에서는 **제품 규칙 → 자세히 보기 → 이번 실행만 고치기**로 그 실행에만 쓰는 프로필을 고칠 수 있다 (템플릿에 남기려면 실행에서 템플릿으로 저장).

**동시에 고칠 때**: 템플릿은 모두가 함께 쓰므로 버전 번호로 충돌을 막는다.
- `GET /api/templates/{id}`의 `profile_version` = 지금 쓰는 버전. 템플릿을 적용한 실행은 `RunInput.profile_version`에 그 번호를 남긴다.
- 실행을 그 템플릿에 덮어쓸 때 그 사이 규칙이 바뀌었으면: 실행에서 규칙을 고치지 않았으면 템플릿의 새 규칙을 그대로 두고(나머지만 저장),
  고쳤으면 409 (새 템플릿으로 저장해야 함).

**assets/product 기본 사진**은 Fold 프로필(없음, 또는 `device_noun`이 Fold와 같은 프로필)에서만 '적지 않은 자리'에 쓴다 (`uses_fold_photos`).
다른 제품이 우연히 같은 자리 key를 써도 Fold 사진이 들어가지 않는다.
