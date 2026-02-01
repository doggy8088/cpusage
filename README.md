# Copilot Usage Analyzer

這是一個用於分析 GitHub Copilot 聊天記錄並估算成本的命令列工具。它會讀取本地的 Copilot Session Logs (.jsonl)，統計 Token 使用量，並根據模型定價表計算預估費用。

## 特色

- **自動偵測路徑**：預設讀取使用者家目錄下的 Copilot 記錄檔 (`~/.copilot/session-state`)。
- **支援多種模型計價**：包含 GPT-5, GPT-4o, GPT-3.5 等模型的預估價格。
- **每日統計**：提供每日的 Session 數量、Token 使用量與預估成本報表。
- **跨平臺支援**：支援 Windows, macOS, Linux。

## 安裝

```bash
npm install -g @willh/cpusage
```

或者直接使用 `npx` 執行：

```bash
npx @willh/cpusage
```

## 使用方法

### 基本使用

直接執行命令，程式會自動尋找預設路徑下的記錄檔：

```bash
cpusage
```

### 指定記錄檔路徑

如果你的記錄檔存放在其他位置，可以透過設定 `SESSION_DIR` 環境變數來指定：

**Windows (PowerShell):**
```powershell
$env:SESSION_DIR="C:\path\to\your\logs"
cpusage
```

**Linux / macOS:**
```bash
SESSION_DIR=/path/to/your/logs cpusage
```

## 開發與建置

本專案使用 TypeScript 開發並使用 Bun 進行建置。

### 前置需求

- [Bun](https://bun.sh/) (最新版本)

### 安裝依賴

```bash
bun install
```

### 執行開發模式

```bash
bun run start
```

### 建置專案

編譯 TypeScript 原始碼至 `dist/` 目錄：

```bash
bun run build
```

## CI/CD

本專案包含 GitHub Actions Workflow，每次 Push 或 Pull Request 會自動執行建置測試。

## 授權

MIT
