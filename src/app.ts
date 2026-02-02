#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';

// Configuration
// Default to HOME/.copilot/session-state if not provided in env
const SESSION_DIR = process.env.SESSION_DIR || path.join(os.homedir(), '.copilot', 'session-state');

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
        selectedMode?: string;
        selectedModel?: string;
        postTruncationTokensInMessages?: number;
        content?: string;
        transformedContent?: string;
    };
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

            // Back-compat: older setups may store .jsonl directly under SESSION_DIR.
            if (currentDir === sessionDir && entry.name.endsWith('.jsonl')) {
                topLevelJsonl.push(fullPath);
            }
        }
    }

    return eventsJsonl.length > 0 ? eventsJsonl : topLevelJsonl;
}

async function analyzeFiles() {
    if (!fs.existsSync(SESSION_DIR)) {
        console.error(`Directory not found: ${SESSION_DIR}`);
        console.error(`Please check if Copilot logs exist or set SESSION_DIR environment variable.`);
        process.exit(1);
    }

    const files = findSessionLogFiles(SESSION_DIR);
    if (verbose) {
        console.log(`Analyzing logs from: ${SESSION_DIR}`);
        console.log(`Found ${files.length} session logs.`);
        if (files.length > 0) {
            console.log(`Sample log: ${files[0]}`);
        }
    }

    let totalSessions = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    const aggStats: Record<string, DailyStats> = {};

    for (const filePath of files) {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let sessionDateObj: Date | null = null;
        let sessionInputTokensFromMessages = 0;
        let sessionInputTokensFromTruncationMax = 0;
        let sessionOutputTokens = 0;
        let sessionModel = 'default'; // Default model

        for await (const line of rl) {
            try {
                if (!line.trim()) continue;
                const event = JSON.parse(line) as LogEvent;

                // Get Session Date
                if (event.type === 'session.start' && event.data.startTime) {
                    sessionDateObj = new Date(event.data.startTime);
                    
                    // Attempt to find model in session.start (if ever added)
                    sessionModel = event.data.selectedModel || event.data.selectedMode || sessionModel;
                }

                // Check other events for model info (just in case)
                if (event.type === 'session.info') {
                    sessionModel = event.data.selectedModel || event.data.selectedMode || sessionModel;
                }

                // Input Tokens (estimate)
                if (event.type === 'user.message') {
                    const content = event.data.transformedContent || event.data.content || '';
                    sessionInputTokensFromMessages += estimateTokensFromText(content);
                }

                // Input Tokens (if present in logs, treat as more authoritative than heuristics)
                if (event.type === 'session.truncation') {
                    sessionInputTokensFromTruncationMax = Math.max(
                        sessionInputTokensFromTruncationMax,
                        event.data.postTruncationTokensInMessages || 0
                    );
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
            sessionInputTokensFromTruncationMax > 0
                ? sessionInputTokensFromTruncationMax
                : sessionInputTokensFromMessages;

        if (sessionDateObj) {
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
        }
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