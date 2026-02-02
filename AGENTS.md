# Gemini Project Context: cpusage

本文件由 Gemini Agent 自動生成，旨在為未來的互動提供專案背景資訊與操作指南。

## 專案概述

**cpusage** 是一個命令列工具 (CLI)，用於分析 GitHub Copilot 的聊天記錄並估算成本。
它讀取本地的 `.jsonl` 記錄檔，解析 session 事件，統計輸入與輸出的 Token 數量，並根據內建的模型定價表計算預估費用。

### 主要技術棧

*   **語言:** TypeScript
*   **執行環境/工具:** [Bun](https://bun.sh/) (用於依賴管理、執行與打包), Node.js (目標執行環境)
*   **核心邏輯:** 解析 JSON Lines 格式日誌，聚合數據，CLI 輸出格式化。

### 目錄結構

*   `src/app.ts`: 應用程式的主要進入點與邏輯核心。
*   `dist/`: 建置後的輸出目錄，包含 `app.js`。
*   `docs/FILE_FORMAT.md`: 詳細說明 Copilot Session State 檔案結構 (`.copilot/session-state`) 的文件。
*   `.github/workflows/ci.yml`: GitHub Actions 配置，負責自動建置與發布至 npm。

## 建置與執行

本專案使用 `bun` 作為主要的開發工具。

### 安裝依賴

```bash
bun install
```

### 開發模式執行

直接執行 TypeScript 原始碼：

```bash
bun run start
# 或
bun run src/app.ts [options]
```

### 建置專案

將 TypeScript 編譯並打包為單一 JavaScript 檔案至 `dist/app.js`：

```bash
bun run build
```

### 執行建置後的程式

```bash
node dist/app.js [options]
```

## 開發規範與慣例

*   **語言偏好:** 文件與回應請使用 **繁體中文 (Traditional Chinese)**。
*   **程式碼風格:** 遵循 TypeScript 嚴格模式 (`strict: true`)。
*   **版本控制:**
    *   Commit 訊息建議遵循 Conventional Commits 規範。
    *   主要分支為 `main`。
*   **發布流程:**
    *   CI/CD (GitHub Actions) 會在 `main` 分支有推送且 `package.json` 變更時，自動執行建置並發布至 npm。
    *   使用 `npm run bump:patch` 等指令來更新版本號 (不含 git tag)。

## 常用指令參數

`cpusage` 支援以下參數 (詳見 `src/app.ts` 或執行 `--help`):

*   `--rank`: 依成本排序。
*   `--limit <n>`: 限制顯示筆數。
*   `--unit <day|month|hour>`: 設定統計的時間單位。
*   `--json`: 輸出 JSON 格式以便程式化處理。
*   `--list-price`: 顯示目前的定價表。

## 備註

*   Copilot 的日誌通常位於 `~/.copilot/session-state` (Windows 下為 `%USERPROFILE%\.copilot\session-state`)。
*   日誌結構包含根目錄的 `*.jsonl` 與子目錄下的 `events.jsonl`，程式需同時處理這兩種來源。
