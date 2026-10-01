"""
api/
前後端分離的後端 API（FastAPI）。

- 業務邏輯與資料表沿用 backend/，這一層只負責：驗證身分、檢查權限、把畫面需要的查詢／寫入包成 HTTP 端點。
- 權限規則與舊版 Streamlit 的選單一致（api/navigation.py），不放寬也不收緊。
- 前端（web/）只透過 /api/* 溝通，不直接碰資料庫。
"""
