"""
api/main.py
FastAPI 入口：`uvicorn api.main:app`。

- 啟動時載入 .env（隔離測試模式除外）並初始化資料庫（與舊版 app.py 相同）。
- 錯誤一律轉成 {"detail": "中文訊息"}；未預期的例外只記 log，不把內部細節回給前端。
- CORS 只在開發時需要（Vite 開發伺服器在 5173）；正式部署前端與 API 由 nginx 同網域提供。
"""

from __future__ import annotations

import logging
import os
import sqlite3

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if os.getenv("ERP_ISOLATED_TEST") != "1":
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except Exception:
        pass

from backend import init_db  # noqa: E402

from api.errors import ConflictError, DomainError, NotFoundError  # noqa: E402
from api.routers import router  # noqa: E402

log = logging.getLogger("erp.api")


def create_app(*, initialize_database: bool = True) -> FastAPI:
    if initialize_database:
        init_db()
    app = FastAPI(title="ERP API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

    origins = [o.strip() for o in os.getenv("ERP_CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def _json(code: int, message: str) -> JSONResponse:
        return JSONResponse(status_code=code, content={"detail": message})

    @app.exception_handler(ConflictError)
    async def _conflict(_: Request, exc: ConflictError):
        return _json(status.HTTP_409_CONFLICT, str(exc))

    @app.exception_handler(NotFoundError)
    async def _not_found(_: Request, exc: NotFoundError):
        return _json(status.HTTP_404_NOT_FOUND, str(exc))

    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError):
        return _json(status.HTTP_400_BAD_REQUEST, str(exc))

    @app.exception_handler(PermissionError)
    async def _forbidden(_: Request, exc: PermissionError):
        return _json(status.HTTP_403_FORBIDDEN, "此帳號沒有這項功能的權限")

    @app.exception_handler(sqlite3.OperationalError)
    async def _db_busy(_: Request, exc: sqlite3.OperationalError):
        log.exception("database error")
        return _json(status.HTTP_503_SERVICE_UNAVAILABLE, "資料庫忙碌中，請稍後再試")

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception):
        log.exception("unhandled error")
        return _json(status.HTTP_500_INTERNAL_SERVER_ERROR, "系統發生錯誤，請稍後再試")

    app.include_router(router)
    return app


app = create_app(initialize_database=os.getenv("ERP_API_SKIP_INIT") != "1")
