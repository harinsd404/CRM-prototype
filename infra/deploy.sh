#!/usr/bin/env bash
# Proxmox LXC(Debian/Ubuntu, root)에 7777 포트로 배포한다. 다시 실행하면 최신 코드로 갱신된다.
#   git clone https://github.com/harinsd404/CRM-prototype.git /opt/crm && bash /opt/crm/infra/deploy.sh
# 경로 아래에서 열 때 (Cloudflare가 /park를 떼지 않고 넘김): BASE_PATH=/park bash /opt/crm/infra/deploy.sh
#   한 번 주면 backend/.env에 저장되어 다음부터는 생략해도 된다
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-7777}"
export PATH="/root/.local/bin:$PATH"

echo "== 1. 패키지"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pnpm >/dev/null || npm install -g pnpm >/dev/null
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh

echo "== 2. 코드 갱신"
git -C "$APP_DIR" pull --ff-only || true

echo "== 3. 백엔드"
cd "$APP_DIR/backend"
[ -f .env ] || cp .env.example .env   # 처음엔 mock 모드. Vertex를 쓰려면 .env를 고친다
if [ -n "${BASE_PATH+x}" ]; then
  sed -i '/^BASE_PATH=/d' .env && echo "BASE_PATH=$BASE_PATH" >> .env
fi
BASE_PATH="$(grep -E '^BASE_PATH=' .env | cut -d= -f2- || true)"
BASE_PATH="${BASE_PATH%/}"
uv sync

echo "== 4. 프론트 빌드"
cd "$APP_DIR/frontend"
pnpm install --frozen-lockfile
VITE_BASE="$BASE_PATH/" pnpm build

echo "== 5. systemd 서비스"
cat >/etc/systemd/system/crm.service <<EOF
[Unit]
Description=CRM prototype (port $PORT)
After=network-online.target

[Service]
WorkingDirectory=$APP_DIR/backend
ExecStart=/root/.local/bin/uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable crm >/dev/null 2>&1
systemctl restart crm

sleep 4
if curl -fs "http://localhost:$PORT$BASE_PATH/api/health"; then
  echo
  echo "== 완료: http://$(hostname -I | awk '{print $1}'):$PORT$BASE_PATH/"
else
  echo "== 실패: journalctl -u crm -n 50 로 확인"
  exit 1
fi
