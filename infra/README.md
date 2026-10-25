# GCP 텍스트 모델 서버 (보류)

> ⏸ 회사 GCP는 Colab Enterprise e2-standard-4(GPU 없음)라 이 계획은 지금 쓸 수 없다.
> GPU 런타임을 쓸 수 있게 되면 다시 검토한다. 이미지는 Vertex AI Gemini를 쓰므로 이미지 서버는 없다.

텍스트 모델(vLLM)을 L4 GPU VM에 띄운다.
서버는 `127.0.0.1`에만 열고, 로컬에서는 **IAP 터널**로 접속한다 (외부 IP 불필요).

> ⚠️ 아래 명령은 아직 실제 GCP에서 검증하지 않았다. 회사 프로젝트의 리전, 네트워크, 이미지 정책에 맞게 값을 확인할 것.

## 1. VM 만들기 (예시)

```bash
PROJECT=회사-프로젝트-ID
ZONE=asia-northeast3-a   # 서울. L4 재고/할당량 확인 필요

gcloud compute instances create crm-llm \
  --project=$PROJECT --zone=$ZONE \
  --machine-type=g2-standard-8 \
  --accelerator=type=nvidia-l4,count=1 \
  --maintenance-policy=TERMINATE \
  --no-address \
  --boot-disk-size=150GB \
  --image-project=deeplearning-platform-release \
  --image-family=<CUDA 포함 Deep Learning VM 이미지 패밀리> \
  --metadata=install-nvidia-driver=True
```

안 쓸 때는 꼭 멈춘다: `gcloud compute instances stop crm-llm --zone=$ZONE`

## 2. 서버 실행

```bash
# 텍스트 VM
gcloud compute ssh crm-llm --zone=$ZONE --tunnel-through-iap
./start-vllm.sh            # infra/llm/start-vllm.sh 를 VM에 복사해서 실행
```

## 3. 로컬에서 접속

```bash
gcloud compute ssh crm-llm   --zone=$ZONE --tunnel-through-iap -- -N -L 8001:localhost:8000
```

`backend/.env`

```env
LLM_PROVIDER=openai
LLM_BASE_URL=http://localhost:8001/v1
LLM_MODEL=Qwen/Qwen3-8B
```
