# Copilot Usage Analyzer

A command-line tool for analyzing GitHub Copilot chat logs and estimating costs. It reads local Copilot Session Logs (.jsonl) and usage entries from `~/.copilot/logs`, prefers usage token totals, and falls back to session-state estimates when usage data is unavailable.

## Features

- **Auto-detection**: Reads usage entries from `~/.copilot/logs` and Copilot logs from the user's home directory (`~/.copilot/session-state`), and falls back to session-state estimates when usage data is unavailable.
- **Multi-model Pricing Support**: Includes estimated pricing for GPT-5, GPT-4, Claude, and more.
- **Flexible Aggregation**: Supports aggregation by day, month, or hour.
- **Ranking & Filtering**: Sort by cost and limit the number of results.
- **JSON Output**: Supports JSON format output for easy integration with other tools.
- **Cross-Platform**: Supports Windows, macOS, and Linux.

## Installation

```bash
npm install -g @willh/cpusage
```

Or run directly using `npx`:

```bash
npx @willh/cpusage
```

## Usage

### Basic Usage

Run the command directly. The program will automatically look for log files in the default path and display them sorted by date in descending order:

```bash
cpusage
```

### Command Line Options

| Option | Description |
| --- | --- |
| `-h`, `--help` | Show help message |
| `--rank` | Sort output by estimated cost (descending) (defaults to top 10) |
| `--limit <n>` | Limit the number of results (Default: 10 if using `--rank`, otherwise shows all) |
| `--unit <unit>` | Aggregation unit: `day` (default), `month`, `hour` |
| `--verbose` | Show detailed analysis info (log path and count) |
| `--list-price` | Show current pricing table |
| `--json` | Output results in JSON format (excludes summary header) |

### Examples

**Show the top 5 days by cost:**
```bash
cpusage --rank --limit 5
```

**Aggregate by month and output JSON:**
```bash
cpusage --unit month --json
```

**View current pricing table:**
```bash
cpusage --list-price
```

### Specifying Log Directory

If your logs are stored in a different location, you can specify it by setting the `SESSION_DIR` environment variable:

**Windows (PowerShell):**
```powershell
$env:SESSION_DIR="C:\path\to\your\logs"
cpusage
```

**Linux / macOS:**
```bash
SESSION_DIR=/path/to/your/logs cpusage
```

## Development & Build

This project is developed using TypeScript and built with Bun.

### Prerequisites

- [Bun](https://bun.sh/) (Latest version)

### Install Dependencies

```bash
bun install
```

### Run in Development Mode

```bash
bun run start
```

### Build Project

Compile TypeScript source code to the `dist/` directory:

```bash
bun run build
```

## CI/CD

This project includes a GitHub Actions Workflow that automatically runs build tests on every Push or Pull Request.

## License

MIT
