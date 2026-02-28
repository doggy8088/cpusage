#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';

// Configuration
// Default to HOME/.copilot/session-state if not provided in env
const SESSION_DIR = process.env.SESSION_DIR || path.join(os.homedir(), '.copilot', 'session-state');
const LOG_DIR = path.join(os.homedir(), '.copilot', 'logs');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_LOG_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.log$/i;
const PROCESS_LOG_FILE_PATTERN = /^process-.*\.log$/i;
const LOG_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+\[[^\]]+\]\s?(.*)$/;
const SESSION_CONTEXT_PATTERN = /\b(?:session|Workspace initialized:)\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

interface Pricing {
    input: number;
    output: number;
}

// Pricing Table (USD per 1M tokens)
const PRICING_TABLE: Record<string, Pricing> = {
    // OpenAI GPT-5.2 系列
    'gpt-5.2-codex': { input: 1.75, output: 14.00 },
    'gpt-5.2': { input: 1.75, output: 14.00 },
    
    // OpenAI GPT-5.1 系列
    'gpt-5.1-codex-max': { input: 1.25, output: 10.00 },
    'gpt-5.1-codex': { input: 1.25, output: 10.00 },
    'gpt-5.1': { input: 1.25, output: 10.00 },
    'gpt-5.1-codex-mini': { input: 0.25, output: 2.00 },
    
    // OpenAI GPT-5 與其他
    'gpt-5': { input: 1.25, output: 10.00 },
    'gpt-5-mini': { input: 0.25, output: 2.00 },
    'gpt-4.1': { input: 2.00, output: 8.00 },
    
    // Anthropic Claude 系列
    'claude-opus-4.5': { input: 5.00, output: 25.00 },
    'claude-sonnet-4.5': { input: 1.00, output: 3.00 },
    'claude-sonnet-4': { input: 1.00, output: 3.00 },
    'claude-haiku-4.5': { input: 0.10, output: 0.50 },
    
    // Google Gemini 系列
    'gemini-3-pro-preview': { input: 2.00, output: 12.00 },
    
    // 預設值
    'default': { input: 1.00, output: 3.00 }
};

interface DailyStats {
    sessions: number;
    input: number;
    output: number;
    cost: number;
}

interface LogEvent {
    type: string;
    data: {
        startTime?: string;
        sessionId?: string;
        selectedMode?: string;
        selectedModel?: string;
        model?: string;
        postTruncationTokensInMessages?: number;
        content?: string;
        transformedContent?: string;
    };
}

interface SessionUsage {
    date: Date;
    inputTokens: number;
    outputTokens: number;
    model: string;
}

interface LogSessionUsage {
    inputTokens: number;
    outputTokens: number;
    model: string;
    timestamp: Date | null;
}

interface ParsedUsageRecord {
    promptTokens: number;
    completionTokens: number;
    responseId: string | null;
    sessionId: string | null;
    model: string | null;
}

// Argument Parsing
const args = process.argv.slice(2);
const showHelp = args.includes('-h') || args.includes('--help');
const listPrice = args.includes('--list-price');
const rankByCost = args.includes('--rank');
const jsonOutput = args.includes('--json');
const verbose = args.includes('--verbose');
const unitIndex = args.indexOf('--unit');
const limitIndex = args.indexOf('--limit');
let timeUnit: 'day' | 'month' | 'hour' = 'day';
let limit = rankByCost ? 10 : Infinity; // Default limit for rank is 10

if (unitIndex !== -1 && args[unitIndex + 1]) {
    const unitArg = args[unitIndex + 1].toLowerCase();
    if (['day', 'month', 'hour'].includes(unitArg)) {
        timeUnit = unitArg as 'day' | 'month' | 'hour';
    } else {
        console.error(`Invalid unit: ${unitArg}. Using default 'day'.`);
    }
}

if (limitIndex !== -1 && args[limitIndex + 1]) {
    const limitArg = parseInt(args[limitIndex + 1], 10);
    if (!isNaN(limitArg) && limitArg > 1) {
        limit = limitArg;
    } else {
        console.error(`Invalid limit: ${args[limitIndex + 1]}. Must be a number greater than 1.`);
        process.exit(1);
    }
}

if (showHelp) {
    console.log(`
Usage: cpusage [options]

Options:
  -h, --help       Show this help message
  --rank           Sort output by estimated cost (descending)
  --limit <n>      Limit the number of results (default: 10 when using --rank)
  --unit <unit>    Aggregation unit: 'day' (default), 'month', or 'hour'
  --verbose        Show analysis details (log path and count)
  --list-price     Show current pricing table
  --json           Output results in JSON format

Environment Variables:
  SESSION_DIR      Path to Copilot session logs (default: ~/.copilot/session-state)
`);
    process.exit(0);
}

if (listPrice) {
    console.log('=== Current Pricing Table (USD per 1M tokens) ===');
    console.log(`${'Model'.padEnd(25)} | ${'Input'.padEnd(10)} | ${'Output'.padEnd(10)}`);
    console.log(`${'-'.repeat(25)}-|-${'-'.repeat(10)}-|-${'-'.repeat(10)}`);
    for (const [model, pricing] of Object.entries(PRICING_TABLE)) {
        console.log(`${model.padEnd(25)} | $${pricing.input.toFixed(2).padEnd(9)} | $${pricing.output.toFixed(2).padEnd(9)}`);
    }
    process.exit(0);
}
function getAggregationKey(date: Date, unit: 'day' | 'month' | 'hour'): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');

    if (unit === 'month') return `${yyyy}-${mm}`;
    if (unit === 'hour') return `${yyyy}-${mm}-${dd} ${hh}:00`;
    return `${yyyy}-${mm}-${dd}`;
}

function estimateTokensFromText(text: string | undefined): number {
    if (!text) return 0;
    // Rough heuristic: ~4 UTF-8 bytes per token.
    return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

function normalizeModelName(model: string): string {
    return model
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/_/g, '-')
        .replace(/[^a-z0-9.-]/g, '')
        .replace(/-+/g, '-');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function inferSessionIdFromSessionFile(filePath: string): string {
    const fileName = path.basename(filePath);
    if (fileName === 'events.jsonl') {
        return path.basename(path.dirname(filePath));
    }

    return fileName.replace(/\.jsonl$/i, '');
}

function findSessionLogFiles(sessionDir: string): string[] {
    const eventsJsonl: string[] = [];
    const topLevelJsonl: string[] = [];
    const stack: string[] = [sessionDir];

    while (stack.length > 0) {
        const currentDir = stack.pop() as string;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;

            if (entry.name === 'events.jsonl') {
                eventsJsonl.push(fullPath);
                continue;
            }

            // Treat any other .jsonl file as a standalone session log, regardless of directory depth
            if (entry.name.endsWith('.jsonl')) {
                topLevelJsonl.push(fullPath);
            }
        }
    }

    return [...topLevelJsonl, ...eventsJsonl];
}

function findCopilotUsageLogFiles(logDir: string): string[] {
    if (!fs.existsSync(logDir)) {
        return [];
    }

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(logDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const processLogs: string[] = [];
    const uuidLogs: string[] = [];

    for (const entry of entries) {
        if (!entry.isFile()) continue;

        if (PROCESS_LOG_FILE_PATTERN.test(entry.name)) {
            processLogs.push(path.join(logDir, entry.name));
            continue;
        }

        if (UUID_LOG_FILE_PATTERN.test(entry.name)) {
            uuidLogs.push(path.join(logDir, entry.name));
        }
    }

    processLogs.sort();
    uuidLogs.sort();

    return [...processLogs, ...uuidLogs];
}

function extractUsageFromResponsePayload(payload: unknown): ParsedUsageRecord | null {
    if (!isRecord(payload)) return null;

    const usage = payload.usage;
    if (!isRecord(usage)) return null;

    const promptTokens = usage.prompt_tokens;
    const completionTokens = usage.completion_tokens;
    if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') return null;

    const responseId = typeof payload.id === 'string'
        ? payload.id
        : (typeof payload.responseId === 'string' ? payload.responseId : null);
    const sessionIdValue = payload.sessionId ?? payload.session_id;
    const sessionId = typeof sessionIdValue === 'string' ? sessionIdValue : null;
    const model = typeof payload.model === 'string' ? payload.model : null;

    return {
        promptTokens,
        completionTokens,
        responseId,
        sessionId,
        model
    };
}

async function analyzeUsageLogFiles(logFiles: string[]): Promise<Map<string, LogSessionUsage>> {
    const usageBySession = new Map<string, LogSessionUsage>();
    const seenUsageBySessionAndResponse = new Set<string>();

    for (const filePath of logFiles) {
        const fileName = path.basename(filePath);
        const fileSessionId = UUID_LOG_FILE_PATTERN.test(fileName) ? fileName.replace(/\.log$/i, '') : null;
        let currentSessionId: string | null = fileSessionId;
        let jsonBuffer: string[] | null = null;
        let jsonBufferSessionId: string | null = null;
        let jsonBufferTimestamp: Date | null = null;

        const finalizeJsonBuffer = () => {
            if (!jsonBuffer) return;

            const jsonText = jsonBuffer.join('\n').trim();
            const contextSessionId = jsonBufferSessionId;
            const contextTimestamp = jsonBufferTimestamp;
            jsonBuffer = null;
            jsonBufferSessionId = null;
            jsonBufferTimestamp = null;

            if (!jsonText) return;

            let payload: unknown;
            try {
                payload = JSON.parse(jsonText);
            } catch {
                return;
            }

            const usageRecord = extractUsageFromResponsePayload(payload);
            if (!usageRecord) return;

            const sessionId = usageRecord.sessionId || contextSessionId || fileSessionId;
            if (!sessionId || !UUID_PATTERN.test(sessionId)) return;

            if (usageRecord.responseId) {
                const dedupeKey = `${sessionId}:${usageRecord.responseId}`;
                if (seenUsageBySessionAndResponse.has(dedupeKey)) {
                    return;
                }
                seenUsageBySessionAndResponse.add(dedupeKey);
            }

            const existing = usageBySession.get(sessionId);
            if (existing) {
                existing.inputTokens += usageRecord.promptTokens;
                existing.outputTokens += usageRecord.completionTokens;
                if (existing.model === 'default' && usageRecord.model) {
                    existing.model = usageRecord.model;
                }
                if (contextTimestamp && (!existing.timestamp || contextTimestamp < existing.timestamp)) {
                    existing.timestamp = contextTimestamp;
                }
            } else {
                usageBySession.set(sessionId, {
                    inputTokens: usageRecord.promptTokens,
                    outputTokens: usageRecord.completionTokens,
                    model: usageRecord.model || 'default',
                    timestamp: contextTimestamp
                });
            }
        };

        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            const prefixMatch = line.match(LOG_PREFIX_PATTERN);

            if (jsonBuffer && prefixMatch) {
                finalizeJsonBuffer();
            }

            if (!prefixMatch) {
                if (jsonBuffer) {
                    jsonBuffer.push(line);
                }
                continue;
            }

            const payloadLine = prefixMatch[2] || '';
            const sessionMatch = payloadLine.match(SESSION_CONTEXT_PATTERN);
            if (sessionMatch) {
                currentSessionId = sessionMatch[1];
            }

            if (!jsonBuffer && payloadLine.trimStart().startsWith('{')) {
                const timestamp = new Date(prefixMatch[1]);
                jsonBuffer = [payloadLine];
                jsonBufferSessionId = currentSessionId;
                jsonBufferTimestamp = Number.isNaN(timestamp.getTime()) ? null : timestamp;
            }
        }

        if (jsonBuffer) {
            finalizeJsonBuffer();
        }
    }

    return usageBySession;
}

async function analyzeFiles() {
    const hasSessionDir = fs.existsSync(SESSION_DIR);
    const hasLogDir = fs.existsSync(LOG_DIR);

    if (!hasSessionDir && !hasLogDir) {
        console.error(`Directory not found: ${SESSION_DIR} or ${LOG_DIR}`);
        console.error(`Please check if Copilot logs exist or set SESSION_DIR environment variable.`);
        process.exit(1);
    }

    const files = hasSessionDir ? findSessionLogFiles(SESSION_DIR) : [];
    const usageLogFiles = hasLogDir ? findCopilotUsageLogFiles(LOG_DIR) : [];
    const usageFromLogsBySession = await analyzeUsageLogFiles(usageLogFiles);

    if (verbose) {
        if (hasSessionDir) {
            console.log(`Analyzing logs from: ${SESSION_DIR}`);
            console.log(`Found ${files.length} session logs.`);
        } else {
            console.log(`Session-state directory not found: ${SESSION_DIR}`);
        }
        if (hasLogDir) {
            console.log(`Analyzing usage logs from: ${LOG_DIR}`);
            console.log(`Found ${usageLogFiles.length} usage logs.`);
        } else {
            console.log(`Usage log directory not found: ${LOG_DIR}`);
        }
        console.log(`Found usage totals for ${usageFromLogsBySession.size} sessions from usage logs.`);
        if (files.length > 0) {
            console.log(`Sample log: ${files[0]}`);
        }
    }

    let totalSessions = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    const aggStats: Record<string, DailyStats> = {};
    const sessionStateUsage = new Map<string, SessionUsage>();

    const addSessionUsage = (sessionDateObj: Date, sessionInputTokens: number, sessionOutputTokens: number, sessionModel: string) => {
        totalSessions++;
        totalInputTokens += sessionInputTokens;
        totalOutputTokens += sessionOutputTokens;

        // Determine pricing for this session
        let pricing = PRICING_TABLE[sessionModel] || PRICING_TABLE['default'];

        // Normalize model name check (case insensitive)
        const normalizedModel = normalizeModelName(sessionModel);
        for (const key of Object.keys(PRICING_TABLE)) {
            if (normalizedModel.includes(key)) {
                pricing = PRICING_TABLE[key];
                break;
            }
        }

        const sessionCost = (sessionInputTokens / 1_000_000 * pricing.input) +
                            (sessionOutputTokens / 1_000_000 * pricing.output);

        totalCost += sessionCost;

        const aggKey = getAggregationKey(sessionDateObj, timeUnit);
        if (!aggStats[aggKey]) {
            aggStats[aggKey] = { sessions: 0, input: 0, output: 0, cost: 0 };
        }
        aggStats[aggKey].sessions++;
        aggStats[aggKey].input += sessionInputTokens;
        aggStats[aggKey].output += sessionOutputTokens;
        aggStats[aggKey].cost += sessionCost;
    };

    for (const filePath of files) {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let sessionDateObj: Date | null = null;
        let sessionId = inferSessionIdFromSessionFile(filePath);
        let sessionInputTokensFromMessages = 0;
        let sessionInputTokensFromTruncationSum = 0;
        let sessionOutputTokens = 0;
        let sessionModel = 'default'; // Default model

        for await (const line of rl) {
            try {
                if (!line.trim()) continue;
                const event = JSON.parse(line) as LogEvent;

                // Get Session Date
                if (event.type === 'session.start' && event.data.startTime) {
                    sessionDateObj = new Date(event.data.startTime);
                    if (event.data.sessionId) {
                        sessionId = event.data.sessionId;
                    }
                    
                    // Attempt to find model in session.start (if ever added)
                    sessionModel = event.data.selectedModel || event.data.selectedMode || event.data.model || sessionModel;
                }

                // Check other events for model info (just in case)
                if (event.type === 'session.info') {
                    sessionModel = event.data.selectedModel || event.data.selectedMode || event.data.model || sessionModel;
                }

                // Input Tokens (estimate)
                if (event.type === 'user.message') {
                    const content = event.data.transformedContent || event.data.content || '';
                    sessionInputTokensFromMessages += estimateTokensFromText(content);
                }

                // Input Tokens (if present in logs, treat as more authoritative than heuristics)
                if (event.type === 'session.truncation') {
                    sessionInputTokensFromTruncationSum += (event.data.postTruncationTokensInMessages || 0);
                }

                // Output Tokens
                if (event.type === 'assistant.message') {
                    sessionOutputTokens += estimateTokensFromText(event.data.content || '');
                }

                // Some logs store assistant reasoning separately.
                if (event.type === 'assistant.reasoning') {
                    sessionOutputTokens += estimateTokensFromText(event.data.content || '');
                }

            } catch (e) {
                // Ignore parse errors
            }
        }

        const sessionInputTokens =
            sessionInputTokensFromTruncationSum > 0
                ? sessionInputTokensFromTruncationSum
                : sessionInputTokensFromMessages;

        if (sessionDateObj && !Number.isNaN(sessionDateObj.getTime())) {
            const existingSession = sessionStateUsage.get(sessionId);
            if (existingSession) {
                existingSession.inputTokens += sessionInputTokens;
                existingSession.outputTokens += sessionOutputTokens;
                if (existingSession.model === 'default' && sessionModel !== 'default') {
                    existingSession.model = sessionModel;
                }
                if (sessionDateObj < existingSession.date) {
                    existingSession.date = sessionDateObj;
                }
            } else {
                sessionStateUsage.set(sessionId, {
                    date: sessionDateObj,
                    inputTokens: sessionInputTokens,
                    outputTokens: sessionOutputTokens,
                    model: sessionModel
                });
            }
        }
    }

    const sessionIdsFromState = new Set<string>();
    for (const [sessionId, usage] of sessionStateUsage.entries()) {
        const usageFromLogs = usageFromLogsBySession.get(sessionId);
        if (usageFromLogs) {
            addSessionUsage(
                usage.date,
                usageFromLogs.inputTokens,
                usageFromLogs.outputTokens,
                usageFromLogs.model || usage.model
            );
        } else {
            addSessionUsage(
                usage.date,
                usage.inputTokens,
                usage.outputTokens,
                usage.model
            );
        }
        sessionIdsFromState.add(sessionId);
    }

    for (const [sessionId, usageFromLogs] of usageFromLogsBySession.entries()) {
        if (sessionIdsFromState.has(sessionId)) continue;
        if (!usageFromLogs.timestamp) continue;

        addSessionUsage(
            usageFromLogs.timestamp,
            usageFromLogs.inputTokens,
            usageFromLogs.outputTokens,
            usageFromLogs.model
        );
    }

    // Fill gaps if not ranking by cost (show all dates in range)
    if (!rankByCost && Object.keys(aggStats).length > 0) {
        const keys = Object.keys(aggStats).sort();
        const minKey = keys[0];
        const maxKey = keys[keys.length - 1];

        // Helper to parse key to Date object (local time)
        const parseKeyToDate = (key: string): Date => {
            if (timeUnit === 'month') {
                const [y, m] = key.split('-').map(Number);
                return new Date(y, m - 1, 1);
            }
            if (timeUnit === 'hour') {
                const [dStr, tStr] = key.split(' ');
                const [y, m, d] = dStr.split('-').map(Number);
                const h = parseInt(tStr.split(':')[0], 10);
                return new Date(y, m - 1, d, h);
            }
            // day
            const [y, m, d] = key.split('-').map(Number);
            return new Date(y, m - 1, d);
        };

        let currentKey = minKey;
        let currentDate = parseKeyToDate(minKey);

        while (currentKey < maxKey) {
            // Increment
            if (timeUnit === 'month') {
                currentDate.setMonth(currentDate.getMonth() + 1);
            } else if (timeUnit === 'hour') {
                currentDate.setHours(currentDate.getHours() + 1);
            } else {
                currentDate.setDate(currentDate.getDate() + 1);
            }

            currentKey = getAggregationKey(currentDate, timeUnit);

            // If we've gone past maxKey (should be caught by loop condition, but safe check)
            if (currentKey > maxKey) break;

            if (!aggStats[currentKey]) {
                aggStats[currentKey] = { sessions: 0, input: 0, output: 0, cost: 0 };
            }
        }
    }

    let sortedKeys = Object.keys(aggStats);
    if (rankByCost) {
        sortedKeys.sort((a, b) => aggStats[b].cost - aggStats[a].cost);
    } else {
        sortedKeys.sort().reverse();
    }

    if (limit !== Infinity) {
        sortedKeys = sortedKeys.slice(0, limit);
    }

    if (jsonOutput) {
        const outputData = sortedKeys.map(key => ({
            date: key,
            sessions: aggStats[key].sessions,
            input: aggStats[key].input,
            output: aggStats[key].output,
            cost: Number(aggStats[key].cost.toFixed(4))
        }));
        console.log(JSON.stringify(outputData, null, 2));
        return;
    }

    // Report
    console.log('\n=== GitHub Copilot Usage Analysis (Dynamic Pricing) ===');
    console.log(`Total Sessions: ${totalSessions}`);
    console.log(`Total Input Tokens: ${totalInputTokens.toLocaleString()}`);
    console.log(`Total Output Tokens: ${totalOutputTokens.toLocaleString()}`);
    console.log(`Estimated Total Cost: $${totalCost.toFixed(4)}`);
    console.log(`(Default Model: Claude Sonnet 4.5 @ $1.00/$3.00 per 1M tokens)`);

    console.log(`\n=== Breakdown by ${timeUnit.toUpperCase()} ===`);
    let dateColWidth = 10;
    if (timeUnit === 'month') dateColWidth = 7;
    if (timeUnit === 'hour') dateColWidth = 16;
    
    console.log(`${'Date'.padEnd(dateColWidth)} | Sessions | Input Tokens | Output Tokens | Est. Cost`);
    console.log(`${'-'.repeat(dateColWidth)}-|----------|--------------|---------------|----------`);

    for (const key of sortedKeys) {
        const stats = aggStats[key];
        console.log(`${key.padEnd(dateColWidth)} | ${stats.sessions.toString().padEnd(8)} | ${stats.input.toString().padEnd(12)} | ${stats.output.toString().padEnd(13)} | $${stats.cost.toFixed(4)}`);
    }
}

analyzeFiles().catch(console.error);
