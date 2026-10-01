# 後端映像：FastAPI（api 服務）與舊版 Streamlit（legacy 服務）共用同一個映像，
# 只差啟動指令（見 docker-compose.yml）。
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Taipei \
    ERP_DB_PATH=/app/data/erp.db

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# 程式碼（.env、資料庫、node_modules 等都由 .dockerignore 排除，不會進映像）
COPY . .

# 以非 root 身分執行；資料庫放在 /app/data（由 compose 掛 volume）
RUN useradd --create-home --uid 10001 erp \
    && mkdir -p /app/data \
    && chown -R erp:erp /app/data
USER erp

EXPOSE 8000 8501

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
