#!/usr/bin/env bash
# Codespace 每次啟動時執行：等 Docker 就緒後建置並啟動所有服務。
set -euo pipefail

for _ in $(seq 60); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done

# Codespaces 用 8080 對外（覆蓋 .env.docker 裡的 ERP_HTTP_PORT）
export ERP_HTTP_PORT=8080
docker compose --env-file .env.docker up -d --build --wait

echo ""
echo "ERP 已啟動：到下方「連接埠（PORTS）」分頁開啟 8080，或等瀏覽器自動開啟。"
echo "示範帳號：admin / admin"
