# File Format Analysis Report

This document outlines the structure and schema of files found in the user's `.copilot/session-state` and `.gemini/extensions` directories.

## 1. Copilot Session State (`.copilot/session-state`)

The `.copilot/session-state` directory appears to store interaction history and context for Copilot sessions. It uses a hybrid structure of flat JSONL files and UUID-named subdirectories.

### 1.1. Directory Structure

-   **Root `*.jsonl` Files** (e.g., `00135e7a-c29c-4f8b-9b5a-e71727252fd5.jsonl`):
    -   These serve as standalone session logs.
    -   Each file corresponds to a unique session ID.
    -   They contain a stream of events describing the chat interaction.

-   **UUID Subdirectories** (e.g., `f8532b16-7786-417a-a162-0baebea30a76/`):
    -   These serve as "rich" session containers.
    -   **`workspace.yaml`**: Contains metadata about the session's environment (working directory, git repo).
    -   **`events.jsonl`**: Contains the session log (identical schema to root `*.jsonl` files). Note: Not all subdirectories contain this file.

**Observation**: The set of IDs in the root filenames and the subdirectory names appears to be disjoint. Root files may represent archived or simple sessions, while subdirectories represent sessions with persistent workspace context.

### 1.2. `events.jsonl` Schema

Both the root `*.jsonl` files and the `events.jsonl` files within subdirectories follow the **JSON Lines** format. Each line is a valid JSON object representing a single event.

**Common Fields:**
-   `type` (string): The event type (e.g., `session.start`, `user.message`).
-   `id` (string, UUID): Unique ID for the event.
-   `timestamp` (string, ISO 8601): Time of the event.
-   `parentId` (string, UUID | null): ID of the preceding event (establishing a causal chain).
-   `data` (object): Event-specific payload.

**Key Event Types:**

1.  **`session.start`**
    -   Metadata about the session, producer, and context.
    -   `data.sessionId`: Matches the filename/directory ID.
    -   `data.context`: Includes `cwd`, `gitRoot`, `repository`.

2.  **`session.info`**
    -   System information or status updates.
    -   `data.infoType`: e.g., `authentication`, `mcp`.

3.  **`user.message`**
    -   The user's input.
    -   `data.content`: The text prompt.
    -   `data.attachments`: List of referenced files (path, displayName).

4.  **`assistant.message`**
    -   The agent's response.
    -   `data.content`: Text response.
    -   `data.toolRequests`: List of tools the agent wants to call (e.g., `view`, `edit`).

5.  **`tool.execution_start` / `tool.execution_complete`**
    -   Logs the invocation and result of tool calls.
    -   `data.toolCallId`: Links start/complete events to the request.
    -   `data.result`: The output of the tool (e.g., file content, command output).

### 1.3. `workspace.yaml` Schema

Found within the UUID subdirectories, this file defines the environment context for that session.

**Format**: YAML

**Fields:**
-   `id`: Session UUID (matches directory name).
-   `cwd`: Current Working Directory path.
-   `git_root`: Path to the Git repository root.
-   `repository`: Git repository name (e.g., `owner/repo`).
-   `branch`: Git branch name.
-   `created_at` / `updated_at`: Timestamps.
-   `summary`: (Optional) A brief summary or the initial prompt of the session.

---

## 2. Gemini Extension (`.gemini/extensions/ralph`)

The directory `C:\Users\wakau\.gemini\extensions\ralph` contains a Gemini CLI extension named "ralph".

### 2.1. Extension Structure

-   **`gemini-extension.json`**: The manifest file defining the extension's metadata (name, version, publisher).
-   **`commands/`**: Contains TOML files defining the extension's CLI commands.
    -   Example: `commands/ralph/help.toml` defines the `/ralph:help` command.
-   **`hooks/`**: Contains hook definitions and scripts.
    -   `hooks.json`: Maps events (like `AfterAgent`) to scripts.
    -   `stop-hook.js`: A Node.js script triggered by the hook.
-   **`scripts/`**: Helper scripts for the extension (e.g., `setup.js`, `cancel.js`).
-   **`tests/`**: Tests for the extension's logic.

### 2.2. Command Configuration (`*.toml`)

Commands are defined in TOML files under `commands/<namespace>/`.

**Fields:**
-   `description`: Help text for the command.
-   `prompt`: The system prompt or instruction to inject when the command is invoked.

### 2.3. Hook Configuration (`hooks.json`)

Defines automated behaviors triggered by agent events.

**Structure:**
-   Array of hook objects.
-   `matcher`: Criteria to trigger the hook (e.g., `AfterAgent`).
-   `script`: The script to execute (e.g., `node hooks/stop-hook.js`).

### 2.4. Script Logic (`scripts/`, `hooks/`)
-   Scripts are written in Node.js.
-   They interact with a local state file: `.gemini/ralph/state.json`.
-   **`setup.js`**: Initializes the state directory and file.
-   **`cancel.js`**: Cleans up the state, effectively stopping the "Ralph" loop.
-   **`stop-hook.js`**: Likely implements the logic for the "Ralph" iterative loop, checking stop conditions (max iterations, completion promise) and deciding whether to continue or stop the agent.