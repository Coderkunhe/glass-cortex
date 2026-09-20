# 离线模型部署 SOP

> **适用场景**：目标 Windows Server 位于内网/隔离网络，无法访问 HuggingFace Hub（huggingface.co）和 PyPI。
> **模型**：`sentence-transformers/all-MiniLM-L6-v2`（默认嵌入模型，~90MB）
> **策略**：有网机器预下载 → 打包传输 → 目标机器落盘 + 强制离线模式

---

## 方案总览

```
┌──────────────────┐   打包    ┌──────────────────┐   落盘   ┌──────────────────┐
│  有网跳板机       │  ─────→   │  U盘/内网 SFTP   │  ────→  │  Windows Server  │
│  下载模型 + wheels │           │  中转 zip        │          │  离线加载         │
└──────────────────┘                                           └──────────────────┘
```

---

## Step 1 — 有网机器：下载并打包

### 1.1 下载嵌入模型

**Windows/Mac/Linux 都可以**（用 Python 3.14）：

```bash
# 建议在临时环境操作，避免污染
python -m venv /tmp/model-fetch
source /tmp/model-fetch/bin/activate   # Windows: /tmp/model-fetch/Scripts/activate

pip install sentence-transformers==5.1.2

# 触发下载到默认 HF cache
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# 验证下载位置
python -c "import os; from pathlib import Path; print(Path.home() / '.cache' / 'huggingface')"
```

**HF cache 默认位置**：

| 平台 | 路径 |
|:--|:--|
| Windows | `%USERPROFILE%\.cache\huggingface\` |
| Linux/Mac | `~/.cache/huggingface/` |

### 1.2 打包 HF cache

**Linux/Mac**：

```bash
cd ~/.cache
tar czf /tmp/hf-cache.tar.gz huggingface/
ls -lh /tmp/hf-cache.tar.gz   # 期望 ~90MB
```

**Windows PowerShell**：

```powershell
$src = "$env:USERPROFILE\.cache\huggingface"
Compress-Archive -Path $src -DestinationPath C:\temp\hf-cache.zip
```

### 1.3 打包 Python wheels（如果目标机器也无法访问 PyPI）

```bash
cd <glasscortex 项目根>
mkdir -p /tmp/wheels
pip download -r requirements-lock.txt \
    --dest /tmp/wheels \
    --platform win_amd64 \
    --python-version 3.14 \
    --only-binary=:all: \
    --implementation cp

# 打包
cd /tmp
tar czf wheels.tar.gz wheels/
ls -lh wheels.tar.gz   # 期望 ~300-500MB
```

> **注意**：`--only-binary=:all:` 强制只下 wheel 不下源码包，避免目标机器再次编译。
> 少数包（如 `usearch`）可能没有直接 wheel，需要在目标机器上装 VC++ Build Tools 后 `pip install --no-index --find-links=./wheels usearch`。

---

## Step 2 — 传输到目标机器

用 U 盘、内网 SFTP、SMB 共享等任意方式，把两个 tar/zip 拷到目标机的 `C:\temp\`。

**建议校验完整性**（防止传输损坏）：

有网机器算 SHA256：

```powershell
Get-FileHash C:\temp\hf-cache.zip -Algorithm SHA256
Get-FileHash C:\temp\wheels.zip -Algorithm SHA256
```

目标机器复算，比对哈希。

---

## Step 3 — 目标 Windows Server：落盘

### 3.1 解压 HF cache

```powershell
# 假设已通过 deploy.ps1 部署基础脚手架（venv 存在但缺模型）
# 目标路径固定为 %USERPROFILE%\.cache\huggingface\（sentence-transformers 默认读取此处）

Expand-Archive -Path C:\temp\hf-cache.zip -DestinationPath "$env:USERPROFILE\.cache\"

# 验证结构
Get-ChildItem "$env:USERPROFILE\.cache\huggingface\hub" -Recurse -File | Select-Object -First 5
# 期望能看到 models--sentence-transformers--all-MiniLM-L6-v2\ 目录
```

**服务账户注意**：GlassCortexAPI 用 NSSM 默认以 `LocalSystem` 账户运行，其 `USERPROFILE` 是 `C:\Windows\System32\config\systemprofile`。

**两种解决方案**：

**方案 A（推荐 · 简单）**：在 install-services.ps1 中把服务改为登录用户账户运行：

```powershell
# 修改后运行（在 install-services.ps1 install 后追加）
& $nssm set GlassCortexAPI ObjectName ".\<your-user>" "<password>"
```

**方案 B**：把 HF cache 拷到 `LocalSystem` 的 profile：

```powershell
$sysProfile = "C:\Windows\System32\config\systemprofile"
New-Item -ItemType Directory -Force -Path "$sysProfile\.cache" | Out-Null
Copy-Item -Recurse -Force "$env:USERPROFILE\.cache\huggingface" "$sysProfile\.cache\"
```

**方案 C（最健壮）**：用环境变量把 HF cache 路径显式指向共享位置，同时避开账户差异：

在 `install-services.ps1` 的 `Install-Service -Name "GlassCortexAPI" ... -EnvVars` 追加：

```powershell
-EnvVars @{
    "PYTHONPATH" = $AppRoot
    "PYTHONUNBUFFERED" = "1"
    "HF_HOME" = "$AppRoot\models\huggingface"
    "TRANSFORMERS_CACHE" = "$AppRoot\models\huggingface"
    "TRANSFORMERS_OFFLINE" = "1"
    "HF_HUB_OFFLINE" = "1"
}
```

然后：

```powershell
New-Item -ItemType Directory -Force -Path "C:\apps\glasscortex\models" | Out-Null
Expand-Archive -Path C:\temp\hf-cache.zip -DestinationPath "C:\apps\glasscortex\models\"
Rename-Item "C:\apps\glasscortex\models\huggingface" "huggingface"   # 若已同名可跳过
```

### 3.2 安装 Python wheels（若走离线 wheel 方案）

```powershell
Expand-Archive -Path C:\temp\wheels.zip -DestinationPath C:\temp\
cd C:\apps\glasscortex
.\venv\Scripts\pip.exe install --no-index --find-links=C:\temp\wheels -r requirements-lock.txt
```

如遇 `usearch` 编译报错：先装 VC++ Build Tools，再重试。

### 3.3 强制离线模式（防止代码回退到在线下载）

编辑 `C:\apps\glasscortex\.env`，追加：

```
# 禁止 HuggingFace 联网 — 只允许本地缓存
TRANSFORMERS_OFFLINE=1
HF_HUB_OFFLINE=1
```

保存后重启服务：

```powershell
Restart-Service GlassCortexAPI
```

---

## Step 4 — 验证离线加载成功

```powershell
# 查看 API stderr 日志，确认无 HuggingFace Hub 网络调用
Get-Content C:\apps\glasscortex\logs\GlassCortexAPI-stderr.log -Tail 50

# 期望：不出现 "Downloading" / "HTTPSConnectionPool" / "ConnectionError"
# 期望：出现 "SentenceTransformer loaded" 或类似成功日志（代码内可能有 INFO log）

# 端到端验证
Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing
# 期望: 200
```

发送一条聊天，观察 embedding 是否被触发：

```powershell
$body = @{ user_input = "你好，测试离线模型"; stream = $false } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:8000/chat -Method POST -ContentType "application/json" -Body $body
# 期望: HTTP 200 + 正常回复
# 若仍报 "Recall failed: We couldn't connect to 'https://huggingface.co'..."
# → 说明模型未正确加载，回到 Step 3 检查路径与环境变量
```

若返回正常回复且日志无网络错误 → **离线部署闭环成功**。

---

## Patch 模式前置条件（防 /chat 500 复发）

> **复盘 2026-09-20**：线上 `POST /chat` 500，根因是 `build-package.sh --patch` 设 `SKIP_MODEL=true`，错误假设「服务器已有模型」。实际服务器缺 `all-MiniLM-L6-v2` 且无法访问 huggingface.co。

`--patch` 增量模式**默认跳过模型打包**。使用前提是目标服务器**已经**存在模型：

```
C:\apps\glasscortex\models\huggingface\hub\models--sentence-transformers--all-MiniLM-L6-v2\
```

**部署前验证（服务器侧，Admin PowerShell）**：

```powershell
Test-Path C:\apps\glasscortex\models\huggingface\hub\models--sentence-transformers--all-MiniLM-L6-v2
# 期望: True
```

- 返回 `True` → 模型已在，`--patch` 可安全使用。
- 返回 `False` → **不能用裸 `--patch`**。二选一：
  1. 构建机改用 `./deploy/build-package.sh --patch --include-model`（把模型一并打进 patch 包）；
  2. 或单独传输 `hf-cache-all-MiniLM-L6-v2.zip`（本 SOP 步骤 1-3）到服务器落盘。

**部署后验证模型确实加载**：重跑 `install-services.ps1` 后，先直连 API 发一条聊天（见 Step 4），确认返回 200 而非 `Recall failed`。

---

## 常见坑

| 症状 | 根因 | 解法 |
|:--|:--|:--|
| `POST /chat` 返回 500，响应体 `detail` 为 `Recall failed: We couldn't connect to 'https://huggingface.co'` | 服务器缺模型 + 无法联网下载；且 `glasscortex.log` 无 ERROR（`HTTPException` 不写 JSON 日志） | 按本 SOP 落盘模型 + `install-services.ps1` 设离线 env。诊断时直接看**响应体 `detail`**，别只看日志 |
| `OSError: We couldn't connect to 'https://huggingface.co'` | 未设置 `HF_HUB_OFFLINE=1` 或缓存路径不对 | 双重检查环境变量 + 目录 |
| 服务作为 LocalSystem 找不到模型 | `USERPROFILE` 是系统 profile 不是当前用户 | 采用方案 C（`HF_HOME` 显式指定） |
| `sentence-transformers` 报 `LocalEntryNotFoundError` | 缓存目录结构损坏或缺 snapshot | 重新解压 `hf-cache.zip`，验证 `hub\models--sentence-transformers--all-MiniLM-L6-v2\snapshots\` 下有内容 |
| 首次调用极慢（5-10s） | 首次加载模型到内存（正常） | 后续调用会快，可预热：启动后 curl 一次 /chat |

---

## 相关文档

- [部署主手册](./README.md) — §2.3 引用本文档
- HuggingFace 官方离线指南：https://huggingface.co/docs/transformers/installation#offline-mode
- sentence-transformers 缓存路径：https://sbert.net/docs/installation.html
