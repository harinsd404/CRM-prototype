#!/usr/bin/env bash
# GCP GPU VM(L4) 안에서 실행: Qwen3-8B를 OpenAI 호환 API(:8000)로 띄운다.
# 사전 조건: NVIDIA 드라이버 + Docker + nvidia-container-toolkit (GCP Deep Learning VM 이미지면 포함)
set -euo pipefail

MODEL="${MODEL:-Qwen/Qwen3-8B}"

docker run -d --name vllm --restart unless-stopped \
  --gpus all --ipc=host \
  -p 127.0.0.1:8000:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  vllm/vllm-openai:latest \
  --model "$MODEL" \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90

echo "로그: docker logs -f vllm"
echo "확인: curl localhost:8000/v1/models"
