# GlassCortex Windows Server 部署手册

> **适用场景**：内网 Windows Server 2019/2022 · 单机部署 · FastAPI + Next.js standalone + Nginx 反代
> **产物版本**：Phase 67 Batch 2（2026-07-09）
> **目标读者**：运维/SA，未接触过项目源码也能照抄跑通

---

## 0. 30 秒版（老运维直接抄）

```powershell
# 管理员 PowerShell
Set-ExecutionPolicy RemoteSigned -Scope Process -Force
git clone https://github.com/<your-org>/glasscortex.git C:\apps\glasscortex
cd C:\apps\glasscortex
Copy-Item .env.example .env
notepad .env                                       # 填 3 个 API key
.\deploy\deploy.ps1 -SkipClone                     # 一键部署应用服务

# ── nginx 首次装（下载解压到 C:\apps\nginx\ 后）──
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
| GlassCortexWeb 启动即崩，stderr 有 `Cannot find module '.../server.js'` | Next.js standalone 产物路径不对 | 确认 `frontend\.next\standalone\frontend\server.js` 存在。不存在则重跑 `.\deploy\deploy.ps1 -SkipClone -SkipBuild=$false` |
| GlassCortexAPI 启动即崩，stderr 有 `KeyError: 'DEEPSEEK_API_KEY'` | `.env` 未创建或未填 | `notepad C:\apps\glasscortex\.env` 补 key，`Restart-Service GlassCortexAPI` |
| GlassCortexAPI 启动即崩，stderr 有 `HuggingFace Hub` 相关网络错 | 无外网 + 无本地模型缓存 | 走 [离线模型 SOP](./offline-model.md) |
| `http://localhost/api/health` 404 | Nginx location 匹配问题 | 检查 `nginx.conf` `location /api/` 段的 `proxy_pass http://fastapi/;` 末尾斜杠必须有 |
| `http://localhost/` 502 Bad Gateway | 后端服务未启或崩溃 | `Get-Service GlassCortex*`；崩溃则查 stderr 日志 |
| Chat 首次响应超时 | 首次触发嵌入模型下载（~90MB） | 等 30-60s；日志出现 `SentenceTransformer loaded` 即好 |
| 端口被占 (`Address in use`) | 8000/3000 被其他进程占用 | `netstat -ano \| findstr "8000 3000"` 查 PID → `taskkill /PID <pid> /F` |
| 服务无法启动（Access Denied） | NSSM 用了 LocalSystem 但目录 ACL 拒绝 | `icacls C:\apps\glasscortex /grant "NT AUTHORITY\SYSTEM:(OI)(CI)F" /T` |

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
│           └── frontend\
│               └── server.js # ← Web Service 启动入口
└── deploy\                   # 本目录（部署脚本 + 本手册）
```

---

## 7. 相关文档

- [离线模型 SOP](./offline-model.md) — 无外网环境模型分发
- [nginx.conf](./nginx.conf) — Nginx 配置源文件（含 /api SSE 支持）
- [deploy.ps1](./deploy.ps1) — 一键部署脚本源文件
- [install-services.ps1](./install-services.ps1) — NSSM 服务注册源文件
- 项目 README：`../README.md`
- 架构总览：`../docs/architecture.md`
