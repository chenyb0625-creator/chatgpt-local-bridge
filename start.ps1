# ChatGPT Local Bridge - 一键启动脚本 (PowerShell)
$ErrorActionPreference = "Stop"

$ServerDir = Join-Path $PSScriptRoot "server"
$VenvDir = Join-Path $ServerDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$ServerPy = Join-Path $ServerDir "server.py"

# 1. Create venv if missing
if (-not (Test-Path $VenvPython)) {
    Write-Host "[1/3] 创建虚拟环境..." -ForegroundColor Cyan
    python -m venv $VenvDir
    if (-not (Test-Path $VenvPython)) {
        Write-Host "python 命令不可用，尝试 py launcher..." -ForegroundColor Yellow
        py -m venv $VenvDir
    }
}

# 2. Install dependencies
Write-Host "[2/3] 安装依赖..." -ForegroundColor Cyan
& $VenvPython -m pip install --disable-pip-version-check -q -r (Join-Path $ServerDir "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    Write-Host "依赖安装失败，请检查网络。" -ForegroundColor Red
    exit 1
}

# 3. Start server
Write-Host "[3/3] 启动服务器: http://127.0.0.1:8787  (Ctrl+C 停止)" -ForegroundColor Green
& $VenvPython $ServerPy
