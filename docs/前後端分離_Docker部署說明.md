# 前後端分離 + Docker 部署說明

## 架構

```
瀏覽器 ──► web（nginx，對外唯一埠，預設 80）
             ├─ /          React 新前端（核心 ERP）
             ├─ /api/      ──► api（FastAPI，容器內 8000）
             └─ /legacy/   ──► legacy（舊版 Streamlit，容器內 8501）
                                    │
                    api 與 legacy 共用同一個 SQLite（Docker volume：erp-data）
```

| 模組 | 放在哪裡 |
|---|---|
| 登入、營運分析看板 | 新前端 |
| 進銷存：商品／庫存／出入庫／條碼／倉庫 | 新前端 |
| 採購：採購單／供應商／進貨成本／採購歷史 | 新前端 |
| 銷售：報價單／銷售單／客戶消費視覺化／客戶個人消費分析／收款 | 新前端 |
| 財務、人資、碳排、AI 助理、LINE、Agent Dashboard、供應鏈風險 L1–L3、ERP CSV 交換 | 舊版介面（新介面不放入口，直接開 `/legacy/`） |

- 權限規則與舊版選單完全一致（有自動測試比對），每個 API 都會重新檢查帳號是否仍有效。
- 採購單一樣要走審批，不會直接寫入。
- 舊版介面需要再登入一次（兩邊登入狀態目前不共用）。

## 一、第一次安裝 Docker Desktop（每台電腦一次）

1. 下載 Docker Desktop for Windows：https://www.docker.com/products/docker-desktop/
2. 安裝時勾選「Use WSL 2」。需要系統管理員權限，裝完通常要重開機。
3. 開啟 Docker Desktop，等左下角顯示 Engine running。
4. 在 PowerShell 確認：

```powershell
docker version
docker compose version
```

**Docker Desktop 顯示 Virtual Machine Platform not enabled／引擎一直起不來：**
用系統管理員 PowerShell 開啟兩個 Windows 功能，重開機後再更新 WSL。
`wsl --install` 出現錯誤 0x8024001e 是 Microsoft Store 下載失敗，照下面改用 `--web-download` 即可。

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
# 重開機後
wsl --update --web-download
```

## 二、在本機建置並啟動

在專案資料夾（`erp-fullstack`）執行：

```powershell
copy .env.docker.example .env.docker
notepad .env.docker          # 需要 AI 分析就把 LLM 設定從原本的 .env 複製過來
docker compose --env-file .env.docker up -d --build
```

第一次建置約 5–10 分鐘。確認三個服務都起來：

```powershell
docker compose ps
```

瀏覽器開 http://localhost （若改了 `ERP_HTTP_PORT=8080`，就開 http://localhost:8080）。

## 三、讓同網段其他電腦連線

1. 查這台電腦的 IP：`ipconfig`，找「IPv4 位址」，例如 `192.168.1.23`。
2. 其他電腦開 `http://192.168.1.23`（或加上自訂埠號）。
3. 連不到時，先看網路設定檔：Windows「設定 → 網路和網際網路 → 內容」若是「公用」，防火牆會擋外部連線，改成「私人」。
   仍然不行就新增輸入規則開放該埠（需系統管理員）：

```powershell
New-NetFirewallRule -DisplayName "ERP Web" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

## 四、帶到別台電腦

**做法 A：帶原始碼過去重建（最簡單）**
把整個 `erp-fullstack` 資料夾（不含 `web/node_modules`）加上你的 `.env.docker` 複製過去，照第二節執行。對方電腦需要網路下載套件。

**做法 B：帶打包好的映像（對方不需要網路）**
在本機：

```powershell
docker compose --env-file .env.docker build
docker save erp-backend:local erp-web:local -o erp-images.tar
```

把 `erp-images.tar`、`docker-compose.yml`、`.env.docker` 放同一個資料夾帶過去，在對方電腦：

```powershell
docker load -i erp-images.tar
docker compose --env-file .env.docker up -d --no-build
```

注意：映像是依建置電腦的 CPU 架構產生。Windows／Intel Mac 通用；對方若是 Apple M 系列晶片，請改用做法 A。

## 五、常用指令

| 目的 | 指令 |
|---|---|
| 看即時紀錄 | `docker compose logs -f api` |
| 停止 | `docker compose down` |
| 改了程式後更新 | `docker compose --env-file .env.docker up -d --build` |
| 備份資料庫 | `docker compose cp api:/app/data/erp.db ./erp-backup.db` |
| 清空資料重來 | `docker compose down -v`（會刪掉資料庫，無法復原） |

## 六、示範帳號（`ERP_DEMO_MODE=true` 時）

| 帳號／密碼 | 角色 | 新前端看得到 |
|---|---|---|
| admin / admin | 系統管理員 | 全部 |
| wh1 / wh1 | 倉管 | 看板、進銷存、採購 |
| sales1 / sales1 | 業務 | 看板、銷售 |
| hr1 / hr1 | 人資 | 看板（人資在舊版介面） |

內網測試用；放到公開網路前必須把 `ERP_DEMO_MODE` 改成 `false` 並建立正式帳號，也要另外加上 HTTPS。

## 七、不用 Docker 的開發模式

```powershell
# 終端機 1：後端
python -m uvicorn api.main:app --port 8000 --reload
# 終端機 2：前端
cd web
npm install
npm run dev
```

瀏覽器開 http://localhost:5173 。API 文件在 http://localhost:8000/api/docs 。
