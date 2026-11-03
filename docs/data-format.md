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
| `PodName` | `디자인` `디스플레이` `성능` `카메라` `Now nudge` | 삼성닷컴 Pod. 이 순서가 기본 순서 |
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
| `used_first_pod` | `PodName` \| null | – | 앞선 타겟에서 이미 1순위로 쓴 Pod. ①에서 1순위로 다시 쓰면 경고 |
| `product_name` | string | ✔ | 영문 공식 제품명 |
| `colors` | string | ✔ | 컬러 라인업, 쉼표로 구분. ③에서 제품 색은 이 중 하나여야 한다 |
| `specs` | `{PodName: string}` | ✔ | Pod별 스펙(Fact). **하나 이상은 내용이 있어야 함** (없으면 422). 카피의 팩트체크 근거는 이 원문과 대조된다 |
| `product_images` | `{자리: string \| null}` | – (기본 `{}`) | 공식 제품 사진을 바꾸거나 지운 자리만. 자리 = `closed_front` · `closed_back` · `closed_views` · `unfolded` · `color_lineup`. 없는 자리 = `assets/product`의 기본 사진, `null` = 지움, 문자열 = `POST /api/uploads`가 돌려준 파일 이름. 실행을 만들 때 `data/runs/{run_id}/product/`로 복사해 ③에서 쓴다 |
| `extra_product_images` | string[] | – (기본 `[]`) | 5자리 외에 더 올린 제품 사진(다른 각도·디테일). `POST /api/uploads`의 파일 이름, **최대 5장** (넘으면 422). `product/extra_1.jpg …`로 복사해 ③에서 ① 사진 뒤에 보조 참조로 보낸다 |

```json
{
  "target_id": "P1",
  "persona": "쇼핑, 패션",
  "mood": "HOT",
  "used_first_pod": null,
  "product_name": "Galaxy Z Fold",
  "colors": "라벤더, 그라파이트, 크림, 피스타치오",
  "specs": {
    "디자인": "201g, 펼친 두께 4.5mm, 8세대에 걸친 폴더블 혁신, 세계에서 가장 가벼운 폴더블, 플렉스 티타늄(디스플레이 하단 이중 티타늄 층), 아머 플렉스힌지, 넓어진 베젤 간격, 아머 알루미늄 프레임, 코닝® 고릴라® 글래스",
    "디스플레이": "커버 10:16 비율, 메인 4:3 비율, 3,000nits, 빛 반사 방지, 갤럭시 폴드 시리즈 사상 가장 평평하게 펼쳐짐, 접힌 상태 138.4mm·펼친 상태 193.2mm 화면",
    "성능": "갤럭시용 스냅드래곤® 8 Elite 5세대(CPU·GPU·NPU 통합), 4,800mAh, 연속 재생 하루 최대 26시간, 30분 만에 최대 63% 고속 충전, 12GB·16GB 메모리, 256GB·512GB·1TB 저장 공간",
    "카메라": "후면 50MP 광각 + 50MP 초광각, 광학 줌 수준의 2배 줌, 10배 디지털 줌, 전면 10MP 커버 카메라 + 10MP 내부 전면 카메라, 나이토그래피, ProVisual Engine 실시간 노이즈 저감, 8K 촬영, 듀얼 레코딩",
    "Now nudge": "Galaxy AI 기능. 흐름을 끊지 않고 먼저 제안. 커버 디스플레이에서 메인 디스플레이까지 자연스럽게 연결, 알림을 누르면 분할 화면으로 전환, 앱 전환 없이 사진 공유·장소 저장 수행"
  }
}
```

LLM에는 이 JSON 대신 아래처럼 바꾼 `[입력 데이터]` 블록이 모든 단계 프롬프트에 들어간다 (`RunInput.format()`).

```text
- 타겟 페르소나 : 쇼핑, 패션
- 소구 강도(무드) : HOT
- 이미 사용된 1순위 Pod : 없음
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

다음 단계로 넘어가는 값은 `edited ?? options[selected]`의 `content`다.

### `StepState` / `RunState` — 실행 전체 상태

모든 API가 이 `RunState`를 그대로 돌려주고, `data/runs/{id}/state.json`에도 이 모양으로 저장된다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | `YYYYMMDD-HHMMSS-{6자리 hex}` |
| `created_at`, `updated_at` | ISO 8601 | |
| `input` | `RunInput` | 1절 |
| `steps` | `{"pod"\|"copy"\|"image": {"slots": {슬롯명: SlotState}}}` | 단계별 상태. 아직 생성 전이면 `slots`가 빈 객체 |
| `html` | string \| null | ④ 조립 결과. 앞 단계를 다시 생성하면 null, 고치기만 하면 바로 다시 조립 |

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
| `items` | `PodPlanItem[]` | **노출 순서대로** 5개. 5개 Pod가 한 번씩 |
| `items[].pod` | `PodName` | |
| `items[].layout` | `Layout` | |
| `items[].reason` | string | 이 순위에 둔 근거 |
| `rationale` | string | 순서·레이아웃 조합의 기획 의도 |

코드 검사 (`check_pod_plan` → `warnings`): 5개 Pod가 한 번씩인가 · 1순위가 `used_first_pod`와 다른가 · 기본 순서 대비 위치가 바뀐 Pod가 3개 이상인가 · 인접한 Pod에 같은 레이아웃이 없는가 · 레이아웃을 4종 이상 썼는가.

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
| `pods` | `PodCopy[]` | ①에서 고른 순서와 같은 순서로 5개 |
| `pods[].pod` | `PodName` | |
| `pods[].eyebrow` | string | Pod명 그대로. **코드가 강제로 맞춘다** |
| `pods[].headline` | string | 헤드카피. 공백 포함 **20자 이내**, 1줄. 넘으면 코드가 모델에게 다시 줄이게 하고, 그래도 넘으면 경고 |
| `pods[].headline_type` | `a`~`e` | 헤드카피 구조 유형. 5개 Pod에서 **4종 이상, 같은 유형 2회 이하** |
| `pods[].body` | string | 바디카피. 2~3문장, 공백 포함 **110자 이내** |
| `pods[].ending_order` | string | 바디 문장 어미 배열 (예 `습니다→죠→보세요`). Pod끼리 겹치면 경고 |
| `pods[].factcheck` | `{expression, source}[]` | 카피 표현과 그 근거가 된 **입력 스펙 원문 구절**. `source`가 그 Pod 스펙(+제품명·컬러)에 실제로 없으면 경고 |
| `rationale` | string | 카피 소구 기획 의도 |

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
| `face` | `hidden` \| `no person` | 얼굴은 항상 비노출 |
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

직접 고친 경우 (② 카피, 성능 Pod의 헤드·바디를 고침 — `edited`에는 5개 Pod 전체를 보낸다):

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
    "content": { "pods": ["… 고친 5개 Pod …"], "rationale": "…" },
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
| `pods` | `PodName[]` | ②에서만 필수. 고칠 Pod들 (여러 개 또는 전체) |

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
| `backend/data/runs/{run_id}/state.json` | `RunState` 전체 (입력, 모든 안, 선택, 수정본, HTML) |
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
