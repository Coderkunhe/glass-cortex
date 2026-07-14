# GlassCortex Windows Server 部署手册

> **适用场景**：内网 Windows Server 2019/2022 · 单机部署 · FastAPI + Next.js standalone + Nginx 反代
> **产物版本**：Phase 67 Batch 3（2026-07-13）
> **目标读者**：运维/SA，未接触过项目源码也能照抄跑通

---

## 0. 30 秒版（老运维直接抄）

**路径 A — Git 部署（服务器有 git + 网络）：**

```powershell
# 管理员 PowerShell
Set-ExecutionPolicy RemoteSigned -Scope Process -Force
git clone https://github.com/<your-org>/glasscortex.git C:\apps\glasscortex
cd C:\apps\glasscortex
Copy-Item .env.example .env
notepad .env                                       # 填 3 个 API key
.\deploy\deploy.ps1 -SkipClone                     # 一键部署应用服务
```

**路径 B — 打包部署（服务器无 git · 无 npm · 可选无网）：**

```powershell
# 构建机侧（有 git + npm + 网络）
cd <project-root>
.\deploy\build-package.ps1                         # 产出一个 zip

# 服务器侧（免 git · 免 npm · 免编译）
Expand-Archive C:\temp\glasscortex-deploy-YYYYMMDD.zip C:\apps\
Rename-Item C:\apps\glasscortex-deploy-YYYYMMDD glasscortex
cd C:\apps\glasscortex
Copy-Item .env.example .env
notepad .env                                       # 填 API key
.\deploy\deploy.ps1                                # 自动检测打包模式 → 离线 pip + 预缓存模型
```

**两条路径汇合 — Nginx：**

```powershell
Copy-Item deploy\nginx.conf C:\apps\nginx\conf\nginx.conf
cd C:\apps\nginx; .\nginx.exe                      # 首次启动（不是 Restart-Service）
Invoke-WebRequest http://localhost -UseBasicParsing   # 冒烟
# 若要 nginx 开机自启 + 崩溃拉起 → 走 §2.2 NSSM 注册（可选）
```

不熟悉的往下看详细版。

---

## 1. 前置条件（Prerequisites）

### 1.1 操作系统

- Windows Server **2019** 或 **2022**（Datacenter/Standard 均可）
- 至少 **4 GB RAM** / **20 GB 可用磁盘**（含模型缓存 ~500MB + 数据增长空间）
- **管理员权限**（安装服务、修改 firewall、netsh binding 需要）

### 1.2 运行时（必装 · 版本硬约束）

| 软件 | 版本要求 | 下载地址 | 用途 |
|:--|:--|:--|:--|
| **Python** | 3.14.x（含 pip） | https://www.python.org/downloads/windows/ | FastAPI 后端运行时 |
| **Node.js** | 22.x LTS 或以上 | https://nodejs.org/en/download | Next.js standalone server 运行时 |
| **Git** | 2.40+ | https://git-scm.com/download/win | 源码 clone / 拉取更新 |
| **Visual C++ Build Tools** | 2019+ | https://aka.ms/vs/17/release/vs_BuildTools.exe | `usearch` 编译依赖（如遇 wheel 缺失） |

**安装时勾选项**：
- Python: ✅ "Add Python to PATH"
- Node.js: ✅ "Automatically install necessary tools"（会顺带装 Chocolatey 依赖）

**验证**：
```powershell
python --version    # Python 3.14.x
node --version      # v22.x.x
git --version       # git version 2.4x.x
```

### 1.3 服务化组件（必装）

| 软件 | 版本 | 下载 | 安装路径（本手册默认） |
|:--|:--|:--|:--|
| **NSSM** | 2.24+ | https://nssm.cc/download | `C:\apps\nssm\nssm.exe` |
| **Nginx** | 1.24+（Windows 版） | http://nginx.org/en/download.html | `C:\apps\nginx\` |

**NSSM 安装步骤**：
1. 下载 zip，解压。
2. 取 `win64\nssm.exe`。
3. 拷贝到 `C:\apps\nssm\nssm.exe`（若路径不同，需在 `install-services.ps1` 用 `-NssmPath` 参数覆盖）。

**Nginx 安装步骤**：
1. 下载 zip，解压到 `C:\apps\nginx\`。
2. 目录内需存在 `conf\`、`logs\`、`nginx.exe`。
3. 首次启动前建议 `Add-Content -Path $env:PATH -Value "C:\apps\nginx"`（可选，方便命令行）。

### 1.4 网络与端口

| 端口 | 服务 | 监听地址 | 备注 |
|:--:|:--|:--|:--|
| **80** | Nginx | 0.0.0.0 | 对外入口 |
| 8000 | FastAPI (uvicorn) | 127.0.0.1 | 仅本地，Nginx 反代 |
| 3000 | Next.js standalone | 127.0.0.1 | 仅本地，Nginx 反代 |

**防火墙**：只需开 80 入站（8000/3000 只绑 127.0.0.1，不应暴露）。

```powershell
New-NetFirewallRule -DisplayName "GlassCortex HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

### 1.5 API 密钥（必需）

- **DeepSeek**：https://platform.deepseek.com/ → 创建 API key
- QWEN、StepFun：可选，用于对比实验/多模态；不填则相关功能自动禁用

---

## 2. 部署（Deployment）

### 2.1 一键部署（推荐）

```powershell
# ── 以管理员身份打开 PowerShell ──
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force

# ── 拉取源码 ──
git clone https://github.com/<your-org>/glasscortex.git C:\apps\glasscortex
cd C:\apps\glasscortex

# ── 配置 API keys ──
Copy-Item .env.example .env
notepad .env
# 编辑填入 DEEPSEEK_API_KEY 等真实值，保存关闭

# ── 一键部署 ──
.\deploy\deploy.ps1 -SkipClone
```

脚本会完成：
1. `[1/6]` 跳过 clone（`-SkipClone`）
2. `[1.5/6]` 兜底 `data\` `logs\` 目录 + `.env` 存在性检查
3. `[2/6]` 创建 `venv\` + `pip install -r requirements-lock.txt`（含 usearch 编译）
4. `[3/6]` 检查 HuggingFace 模型缓存（首次运行会自动下载 ~90MB `all-MiniLM-L6-v2`）
5. `[4/6]` `npm ci` + `npm run build`（Next.js standalone 产物）
6. `[5/6]` 调用 `install-services.ps1` 注册 GlassCortexAPI + GlassCortexWeb 两个 Windows Service（NSSM 托管）
7. `[6/6]` 冒烟检查 `http://127.0.0.1:8000/health` 和 `http://127.0.0.1:3000/`

**参数**：

| 参数 | 默认 | 说明 |
|:--|:--|:--|
| `-GitUrl <url>` | 空 | 提供则脚本自动 clone/pull |
| `-AppRoot <path>` | `C:\apps\glasscortex` | 项目根目录 |
| `-Branch <name>` | `master` | git 分支 |
| `-SkipClone` | 关 | 已 clone 时使用 |
| `-SkipBuild` | 关 | 仅重装服务，不重建前端 |

### 2.2 Nginx 配置

```powershell
# 拷贝 nginx 配置
Copy-Item C:\apps\glasscortex\deploy\nginx.conf C:\apps\nginx\conf\nginx.conf

# 验证语法
cd C:\apps\nginx
.\nginx.exe -t
# 期望输出: nginx: configuration file C:\apps\nginx\conf\nginx.conf test is successful

# 首次启动
.\nginx.exe

# 后续管理
.\nginx.exe -s reload    # 重载配置
.\nginx.exe -s stop      # 停止
```

**注册 Nginx 为 Windows Service（可选，推荐生产使用）**：

```powershell
# 用 NSSM 托管 nginx，实现开机自启 + 崩溃拉起
C:\apps\nssm\nssm.exe install Nginx C:\apps\nginx\nginx.exe
C:\apps\nssm\nssm.exe set Nginx AppDirectory C:\apps\nginx
C:\apps\nssm\nssm.exe set Nginx Start SERVICE_AUTO_START
C:\apps\nssm\nssm.exe start Nginx
```

### 2.3 离线部署（无外网环境）

见 [deploy/offline-model.md](./offline-model.md)。

要点：
1. 在有网机器上预下载 `all-MiniLM-L6-v2` 模型 → 打包 `%USERPROFILE%\.cache\huggingface\` 拷到目标机
2. 在有网机器上 `pip download -r requirements-lock.txt -d ./wheels` → 拷到目标机 `pip install --no-index --find-links=./wheels`
3. `.env` 追加 `TRANSFORMERS_OFFLINE=1` `HF_HUB_OFFLINE=1`

### 2.4 免 Git 部署（打包模式）

> 适用场景：服务器不允许装 Git · 限制外网访问 · 必须通过制品包交付

**原理**：构建机（有 Git + npm + 网络）跑打包脚本产出 zip，服务器只解压 + 注册服务。

**构建机侧（一次性）**：

```bash
# macOS / Linux 构建机（推荐）
chmod +x deploy/build-package.sh
./deploy/build-package.sh

# 参数（全部可选）：
#   -o <path>            产物输出目录（默认: ./deploy-package/）
#   -v <tag>             版本标签（默认: 当前日期 YYYYMMDD）
#   --skip-build         跳过 npm 构建（已有 .next/standalone 时用）
#   --skip-model         跳过模型下载
#   --skip-wheels        跳过 wheel 下载
```

```powershell
# Windows 构建机
.\deploy\build-package.ps1

# 参数（全部可选）：
#   -OutputDir <path>    产物输出目录（默认: .\deploy-package\）
#   -Version <tag>       版本标签（默认: 当前日期 YYYYMMDD）
#   -SkipBuild           跳过 npm 构建
#   -SkipModel           跳过模型下载
#   -SkipWheels          跳过 wheel 下载
```

脚本执行七步：

| 步骤 | 内容 | 说明 |
|:--|:--|:--|
| [1/7] | 准备 staging 目录 | 清理旧临时文件 |
| [2/7] | 拷贝源码 | 排除 .git / venv / node_modules / __pycache__ / data / logs |
| [3/7] | 下载 Python wheels | `pip download` → `wheels/`，服务器侧离线安装 |
| [4/7] | 下载嵌入模型 | `all-MiniLM-L6-v2` (~90MB) → `models/huggingface/` |
| [5/7] | 构建前端 | `npm ci` + `npm run build` → standalone 产物 |
| [6/7] | 创建 zip | `Compress-Archive` → `glasscortex-deploy-YYYYMMDD.zip` |
| [7/7] | 清理 staging | 删除临时目录 |

产物 `glasscortex-deploy-YYYYMMDD.zip` 解压后即为完整项目目录，含预构建前端 + Python wheels + 嵌入模型缓存。

**服务器侧**：

```powershell
# 1. 将 zip 传输到服务器（U盘 / SMB / SFTP 任意方式）
# 2. 解压 + 配置
Expand-Archive -Path C:\temp\glasscortex-deploy-YYYYMMDD.zip -DestinationPath C:\apps\
Rename-Item C:\apps\glasscortex-deploy-YYYYMMDD glasscortex
cd C:\apps\glasscortex

# 3. 配置 .env
Copy-Item .env.example .env
notepad .env

# 4. 一键部署（自动检测打包模式 → SkipClone + SkipBuild + 离线 pip + 预缓存模型）
.\deploy\deploy.ps1

# 5. Nginx（同标准流程）
Copy-Item deploy\nginx.conf C:\apps\nginx\conf\nginx.conf
cd C:\apps\nginx
.\nginx.exe -t
.\nginx.exe
```

`deploy.ps1` 自动检测打包模式（无 `.git` 目录 → 自动启用 `-SkipClone -SkipBuild`），检测到 `wheels/` → 离线 pip 安装，检测到 `models/huggingface/` → 自动配置 `HF_HOME` 环境变量到 Windows Service。

**服务器运行时要求**：

| 组件 | 打包模式 | Git 模式 |
|:--|:--:|:--:|
| Python 3.14 | ✅ 必需 | ✅ 必需 |
| Node.js 22.x | ✅ 必需（运行 standalone server.js） | ✅ 必需 |
| Git | ❌ 不需要 | ✅ 必需 |
| npm | ❌ 不需要 | ✅ 必需 |
| VC++ Build Tools | ❌ 不需要（wheels 预编译） | ✅ 可能需（编译 usearch） |
| 外网（PyPI / npm） | ❌ 不需要 | ✅ 必需 |
| 外网（HuggingFace） | ❌ 不需要（模型已缓存） | 首次运行需要 |

**跨平台打包**（macOS/Linux 构建机 → Windows Server）：

```powershell
# 在 macOS/Linux 上交叉下载 Windows wheels
.\deploy\build-package.ps1 -TargetPlatform win_amd64
```

注意事项：
- 纯 Python 包和有预编译 wheel 的包可直接交叉下载
- 少数无 Windows wheel 的包（如 usearch）需在服务器端编译 → 仍需 VC++ Build Tools
- 推荐：构建机和目标机同平台（都是 Windows）以免交叉编译问题

**升级流程（打包模式）**：

```powershell
# 构建机重新打包新版本 → 传输到服务器
# 服务器侧：
Stop-Service GlassCortexAPI, GlassCortexWeb
Expand-Archive -Force C:\temp\glasscortex-deploy-NEWDATE.zip C:\apps\
# ⚠️ 注意：不要覆盖 data/ 和 .env
Copy-Item C:\apps\glasscortex\data C:\apps\glasscortex-deploy-NEWDATE\data -Recurse -Force
Copy-Item C:\apps\glasscortex\.env C:\apps\glasscortex-deploy-NEWDATE\.env -Force
Remove-Item C:\apps\glasscortex -Recurse -Force
Rename-Item C:\apps\glasscortex-deploy-NEWDATE glasscortex
.\deploy\deploy.ps1 -SkipClone -SkipBuild
```

### 2.5 开发 vs 生产模式

> **关键区分**：`npm run dev`（开发）和 `node server.js`（生产）行为完全不同。生产环境用错会引入 HMR 报错和性能问题。

| | `npm run dev`（开发） | `node server.js`（生产 standalone） |
|:--|:--|:--|
| **用途** | 本地开发，热更新 | 生产部署，稳定运行 |
| **启动命令** | `cd frontend && npm run dev` | `node frontend\.next\standalone\server.js` |
| **HMR** | ✅ 有（WebSocket） | ❌ 无 |
| **性能** | 慢（编译中） | 快（预构建） |
| **端口** | 3000 | 3000 |
| **构建要求** | 无需预构建 | 必须先 `npm run build` |
| **Windows Service** | ❌ 不适用 | ✅ GlassCortexWeb 默认 |
| **webpack-hmr 日志** | 正常 | 不应出现，出现说明启错模式 |

```powershell
# 生产模式正确启动（在项目根目录）：
node frontend\.next\standalone\server.js
# 输出应显示：Listening on port 3000（无 webpack/HMR 日志）

# 常见错误 — 生产环境用了 dev 命令：
# npm run dev   ← 会输出 "webpack compiled" 和 WSS HMR 连接，生产不应出现
```

#### 手动构建完整步骤（无 deploy.ps1 时）

`npm run build` 不会自动将 `.next/static` 拷贝到 standalone 目录。手动构建需完整执行以下步骤：

```powershell
# PowerShell（推荐）
cd C:\apps\glasscortex\frontend
npm ci                                    # 安装依赖
set NODE_ENV=production && npm run build  # 生产构建

# ⚠️ 关键：拷贝 static 到 standalone（npm run build 不做这一步！）
Copy-Item -Recurse -Force .next\static .next\standalone\.next\static

# public 目录（如有字体/favicon）
if (Test-Path public) {
    New-Item -ItemType Directory -Force -Path .next\standalone\public | Out-Null
    Copy-Item -Recurse -Force public\* .next\standalone\public
}

# 启动
node .next\standalone\server.js
```

```cmd
:: CMD 版本
cd C:\apps\glasscortex\frontend
npm ci
set NODE_ENV=production && npm run build

:: ⚠️ 关键：拷贝 static 到 standalone
xcopy /E /I /Y .next\static .next\standalone\.next\static

:: 启动
node .next\standalone\server.js
```

> **`.env.production` 要求**：生产构建依赖 `frontend\.env.production` 中的 `NEXT_PUBLIC_API_URL=/api`。
> 缺失会导致前端 API 请求打到 `http://localhost:8000`（硬编码默认值）而非 nginx `/api/` 反代。
> 若文件不存在：`echo NEXT_PUBLIC_API_URL=/api> .env.production` 后重建。

---

## 3. 验证清单（Verification Checklist）

按顺序跑，每步预期返回都写在旁边。任何一步不通 → 转 §5 排错。

### 3.1 服务层

```powershell
# ① 两个 Windows Service 都在跑
Get-Service GlassCortexAPI, GlassCortexWeb
# 期望: Status=Running

# ② API 直连（绕过 nginx）
Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing
# 期望: StatusCode=200 · Content 含 "ok":true 或 "status":"healthy"

# ③ Web 直连（绕过 nginx）
Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing
# 期望: StatusCode=200 · Content 含 <!DOCTYPE html>
```

### 3.2 Nginx 反代层

```powershell
# ④ Nginx 已启动
Get-Process nginx
# 期望: 至少 2 个 nginx 进程（1 master + N worker）

# ⑤ 通过 nginx 访问 API
Invoke-WebRequest http://localhost/api/health -UseBasicParsing
# 期望: 200 · 同 ②

# ⑥ 通过 nginx 访问前端
Invoke-WebRequest http://localhost/ -UseBasicParsing
# 期望: 200 · <!DOCTYPE html>
```

### 3.3 端到端功能验证

浏览器打开 `http://<server-ip>/` （从另一台机器）：

| 检查点 | 预期 |
|:--|:--|
| 首页加载 | UI 渲染完整，无红色报错 |
| 侧栏切换 | Chat / Learn / Lab / Observability 页面均可打开 |
| Chat 对话 | 发送"你好" → 收到 DeepSeek 回复（首次可能慢 3-5s，需下载模型 + 建索引） |
| 记忆检索 | 对话数轮后关闭重开，之前提到的关键词仍能被召回 |
| Observability | Health 页面显示所有子系统 ✅ |
| **生产模式** | Web 服务 stdout 不应出现 `webpack` / `HMR` / `hot-update` 日志（出现说明用错 `npm run dev`，应用 `node server.js`）|

---

## 4. 运维手册（Operations）

### 4.1 服务管理

> **前提**：本节的 `*-Service Nginx` 命令假设你已按 §2.2 将 nginx 注册为 NSSM 服务。
> 若 nginx 仍以前台进程方式跑，请用 `.\nginx.exe -s reload` / `-s stop`（在 `C:\apps\nginx\` 目录）。

```powershell
# 状态
Get-Service GlassCortexAPI, GlassCortexWeb, Nginx

# 重启单个服务
Restart-Service GlassCortexAPI
Restart-Service GlassCortexWeb

# 完全重启（含 nginx · 需 nginx 已注册为服务）
Restart-Service Nginx, GlassCortexAPI, GlassCortexWeb

# 停止全部
Stop-Service GlassCortexAPI, GlassCortexWeb, Nginx
```

### 4.2 日志位置

| 日志 | 路径 | 说明 |
|:--|:--|:--|
| API stdout | `C:\apps\glasscortex\logs\GlassCortexAPI-stdout.log` | uvicorn 请求日志 |
| API stderr | `C:\apps\glasscortex\logs\GlassCortexAPI-stderr.log` | Python 异常栈 |
| Web stdout | `C:\apps\glasscortex\logs\GlassCortexWeb-stdout.log` | Next.js 输出 |
| Web stderr | `C:\apps\glasscortex\logs\GlassCortexWeb-stderr.log` | Next.js 异常 |
| Nginx access | `C:\apps\nginx\logs\access.log` | 请求访问日志 |
| Nginx error | `C:\apps\nginx\logs\error.log` | Nginx 层错误 |

日志文件超过 10MB 自动轮转（NSSM 配置）。

### 4.3 升级流程

```powershell
cd C:\apps\glasscortex
git fetch origin master
git log HEAD..origin/master --oneline    # 预览变更

Stop-Service GlassCortexAPI, GlassCortexWeb
git pull origin master
.\deploy\deploy.ps1 -SkipClone           # 重新走完 [2/6] 到 [6/6]
# deploy.ps1 会自动重启服务并冒烟
```

### 4.4 回滚流程

```powershell
cd C:\apps\glasscortex
git log --oneline -10                    # 找到上一稳定 commit hash
Stop-Service GlassCortexAPI, GlassCortexWeb
git checkout <last-good-hash>
.\deploy\deploy.ps1 -SkipClone
```

**数据回滚**：`data\memory.db` 建议每日 `Copy-Item` 到 `backups\`；升级前手动备份一次。

### 4.5 数据备份

```powershell
# 定时脚本示例（Windows Task Scheduler）
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item C:\apps\glasscortex\data\memory.db "C:\backups\memory-$stamp.db"
Copy-Item C:\apps\glasscortex\data\index.usearch "C:\backups\index-$stamp.usearch"
```

---

## 5. 常见错误排错（Troubleshooting）

| 症状 | 根因 | 解法 |
|:--|:--|:--|
| `usearch import failed` in deploy [2/6] | 缺 VC++ Build Tools 或 Python 版本不匹配 | 安装 VC++ Build Tools 2019+，`pip install --force-reinstall usearch` |
| `npm ci` 失败 `EACCES / EPERM` | Node.js 权限问题或杀软拦截 | 以管理员打开 PowerShell；将 `C:\apps\glasscortex` 加入杀软白名单 |
| `next build` 报 `standalone: not defined` | `frontend/next.config.ts` 未含 `output: "standalone"` | B1 已配好；若被覆盖，检查该文件 |
| GlassCortexWeb 启动即崩，stderr 有 `Cannot find module '.../server.js'` | Next.js standalone 产物路径不对 | 确认 `frontend\.next\standalone\server.js` 存在。不存在则重跑 `.\deploy\deploy.ps1 -SkipClone -SkipBuild=$false` |
| GlassCortexAPI 启动即崩，stderr 有 `KeyError: 'DEEPSEEK_API_KEY'` | `.env` 未创建或未填 | `notepad C:\apps\glasscortex\.env` 补 key，`Restart-Service GlassCortexAPI` |
| GlassCortexAPI 启动即崩，stderr 有 `HuggingFace Hub` 相关网络错 | 无外网 + 无本地模型缓存 | 走 [离线模型 SOP](./offline-model.md) |
| `http://localhost/api/health` 404 | Nginx location 匹配问题 | 检查 `nginx.conf` `location /api/` 段的 `proxy_pass http://fastapi/;` 末尾斜杠必须有 |
| `http://localhost/` 502 Bad Gateway | 后端服务未启或崩溃 | `Get-Service GlassCortex*`；崩溃则查 stderr 日志 |
| Chat 首次响应超时 | 首次触发嵌入模型下载（~90MB） | 等 30-60s；日志出现 `SentenceTransformer loaded` 即好 |
| 端口被占 (`Address in use`) | 8000/3000 被其他进程占用 | `netstat -ano \| findstr "8000 3000"` 查 PID → `taskkill /PID <pid> /F` |
| 服务无法启动（Access Denied） | NSSM 用了 LocalSystem 但目录 ACL 拒绝 | `icacls C:\apps\glasscortex /grant "NT AUTHORITY\SYSTEM:(OI)(CI)F" /T` |
| 浏览器控制台持续报 `WebSocket connection to 'wss://.../\_next/webpack-hmr' failed` | 生产环境用了 `npm run dev` 启动前端（HMR 只在 dev 模式存在） | 改用生产模式：`npm run build` 后 `node frontend\.next\standalone\server.js`。详见 §2.5 |
| 页面白屏，浏览器 F12 显示 `/\_next/static/...` JS/CSS 404 | nginx `location /\_next/` 段 `proxy_pass` 端口配成了 8000 而非 3000 | 检查 nginx.conf：`location /\_next/` 的 `proxy_pass` 必须是 `http://nextjs`（端口 3000），不是 FastAPI |
| Chat 对话不流式输出（整段一起吐出来）或 30s 超时断开 | nginx `/api/` 段缺 `proxy_buffering off` 或 `proxy_read_timeout` 太短 | nginx.conf 中 `/api/` 段必须配：`proxy_buffering off;` `proxy_cache off;` `proxy_read_timeout 300s;` |
| 安全扫描报警 TLSv1/TLSv1.1 不安全 | nginx `ssl_protocols` 包含了已弃用的 TLS 版本 | 改为 `ssl_protocols TLSv1.2 TLSv1.3;`，去掉 TLSv1 和 TLSv1.1。nginx 参考 TLS 配置见 `deploy/nginx.conf` 底部注释块 |
| 前端 API 请求打到 `http://localhost:8000`（非 `/api/...`），浏览器 F12 Network 全 404 | 构建时 `.env.production` 缺失或未加载，`NEXT_PUBLIC_API_URL` 回退到硬编码默认值 | `echo NEXT_PUBLIC_API_URL=/api> frontend\.env.production`，`set NODE_ENV=production && npm run build`，重启。详见 §2.5 |
| `/_next/static/...` CSS/JS 404，样式全丢、交互失效 | `npm run build` 不会自动拷贝 `.next/static` 到 standalone 目录 | `xcopy /E /I /Y .next\static .next\standalone\.next\static`（CMD）或 `Copy-Item -Recurse -Force .next\static .next\standalone\.next\static`（PowerShell）。详见 §2.5 |

---

## 6. 目录布局参考

部署完成后 `C:\apps\glasscortex\` 结构：

```
C:\apps\glasscortex\
├── .env                      # ← 你手动填的 API keys（.gitignore）
├── venv\                     # Python 虚拟环境
├── data\                     # 运行时数据（不提交）
│   ├── memory.db             # SQLite 记忆库
│   └── index.usearch         # usearch 向量索引
├── logs\                     # NSSM 服务日志（自动轮转）
├── src\ api\ tests\ docs\    # 源码与文档
├── frontend\
│   ├── node_modules\         # npm 依赖
│   └── .next\
│       ├── static\           # 静态资源
│       └── standalone\
│           └── server.js         # ← Web Service 启动入口 (Next.js 16)
└── deploy\                   # 本目录（部署脚本 + 本手册）
    ├── README.md              # 本文件
    ├── build-package.ps1      # 构建机制品打包（§2.4）
    ├── deploy.ps1             # 一键部署
    ├── install-services.ps1   # NSSM 服务注册
    ├── nginx.conf             # Nginx 反代配置
    └── offline-model.md       # 离线模型 SOP
```

---

## 7. 相关文档

- [离线模型 SOP](./offline-model.md) — 无外网环境模型分发
- [build-package.sh](./build-package.sh) — 构建机制品打包（macOS/Linux · §2.4 入口）
- [build-package.ps1](./build-package.ps1) — 构建机制品打包（Windows）
- [nginx.conf](./nginx.conf) — Nginx 配置源文件（含 /api SSE 支持）
- [deploy.ps1](./deploy.ps1) — 一键部署脚本源文件
- [install-services.ps1](./install-services.ps1) — NSSM 服务注册源文件
- 项目 README：`../README.md`
- 架构总览：`../docs/architecture.md`
