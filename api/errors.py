"""API 層的業務錯誤：各自對應一個 HTTP 狀態碼，訊息直接顯示給使用者（中文、不含內部細節）。"""


class DomainError(ValueError):
    """違反業務規則（庫存不足、狀態不合法…）→ 400。"""


class ConflictError(DomainError):
    """資料已存在（編號重複）→ 409。"""


class NotFoundError(LookupError):
    """找不到資料 → 404。"""
