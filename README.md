# CRM 시안 생성 프로토타입

POD 순서 → 카피 → 이미지 단계마다 AI가 N개 안을 만들고, 사람이 하나를 골라(수정해) 다음 단계로 넘기는
사람 검수형 CRM 시안 생성 프로토타입. 설계와 기술 선택 이유는 [docs/plan.md](docs/plan.md).

## 실행

```bash
# 백엔드 (http://localhost:8000/docs)
cd backend
cp .env.example .env      # 처음 한 번
uv run uvicorn app.main:app --reload

# 프론트 (http://localhost:5173)
cd frontend
pnpm install
pnpm dev
```

기본 설정(`LLM_PROVIDER=mock`, `IMAGE_PROVIDER=placeholder`)은 모델 없이 전체 흐름을 확인하는 모드다.

## 모델 연결

| 단계 | 설정 |
|---|---|
| 텍스트 (①②③ 연출안) | Vertex AI Gemini: `LLM_PROVIDER=vertex` (아래 참고) |
| 이미지 | Vertex AI Gemini: `IMAGE_PROVIDER=vertex` (아래 참고) |
| 시연 대비 이미지 | 잘 나온 실행의 이미지를 `uv run python scripts/save_pool.py <run_id>`로 풀에 저장하고 `IMAGE_PROVIDER=pool` (같은 Pod·화면비에서 고름) |
| (선택) 로컬 오픈 모델 | `brew install ollama && ollama pull qwen3:8b` 후 `LLM_PROVIDER=openai` |

### Vertex AI Gemini

1. gcloud CLI 설치 후 로그인: `gcloud auth application-default login`
2. `backend/.env`: `GOOGLE_CLOUD_PROJECT=<프로젝트 ID>`, `LLM_PROVIDER=vertex`
   (모델은 `VERTEX_TEXT_MODEL`, `VERTEX_IMAGE_MODEL`로 바꾼다)
3. 이미지까지 쓰려면 `backend/assets/product/`에 공식 제품 사진을 넣는다 (.png/.jpg/.webp, git에는 올라가지 않음).
   - 필수: `closed_front`, `closed_back`, `unfolded` (제품 상태별 주 참조)
   - 선택: `closed_views` (접힌 상태 측면·후면·정면 한 장), `color_lineup` (컬러 라인업. 제품 사진과 다른 컬러일 때 첨부), `style_anchor` (P2의 ②)
4. `IMAGE_PROVIDER=vertex`. 렌즈 수·배열은 `backend/app/prompts/image_model.md`에 제품 사진 기준으로 적혀 있다.

## 프롬프트 수정

| 파일 | 단계 |
|---|---|
| `backend/app/prompts/pod.md` | ① Pod 순서·레이아웃 (P1에서 분리) |
| `backend/app/prompts/copy.md` | ② 카피 (P1에서 분리) |
| `backend/app/prompts/image_brief.md` | ③ Pod별 이미지 연출안 (P1의 이미지 Input Data) |
| `backend/app/prompts/image_model.md` | 이미지 모델에 그대로 보내는 프롬프트 (P2) |
| `backend/app/templates/crm.html.j2` | ④ HTML 조립 (P3 규칙) |
| `backend/app/prompts/original/` | 원본 P1·P2·P3 보관 |

LLM 프롬프트는 `## system` / `## human` 아래가 각각 시스템·사용자 메시지이고, `{input_data}` 같은 중괄호는 변수다.
중괄호 글자가 필요하면 `{{ }}`로 쓴다. `## system` 위의 주석은 모델에 보내지 않는다.
