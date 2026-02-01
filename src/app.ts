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
        model?: string;
        postTruncationTokensInMessages?: number;
        content?: string;
    };
}

// Argument Parsing
const args = process.argv.slice(2);
const showHelp = args.includes('-h') || args.includes('--help');
const rankByCost = args.includes('--rank');
const verbose = args.includes('--verbose');
const unitIndex = args.indexOf('--unit');
let timeUnit: 'day' | 'month' | 'hour' = 'day';

if (unitIndex !== -1 && args[unitIndex + 1]) {
    const unitArg = args[unitIndex + 1].toLowerCase();
    if (['day', 'month', 'hour'].includes(unitArg)) {
        timeUnit = unitArg as 'day' | 'month' | 'hour';
    } else {
        console.error(`Invalid unit: ${unitArg}. Using default 'day'.`);
    }
}

if (showHelp) {
    console.log(`
Usage: cpusage [options]

Options:
  -h, --help       Show this help message
  --rank           Sort output by estimated cost (descending)
  --unit <unit>    Aggregation unit: 'day' (default), 'month', or 'hour'
  --verbose        Show analysis details (log path and count)

Environment Variables:
  SESSION_DIR      Path to Copilot session logs (default: ~/.copilot/session-state)
`);
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

async function analyzeFiles() {
    if (!fs.existsSync(SESSION_DIR)) {
        console.error(`Directory not found: ${SESSION_DIR}`);
        console.error(`Please check if Copilot logs exist or set SESSION_DIR environment variable.`);
        process.exit(1);
    }

    const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.jsonl'));
    if (verbose) {
        console.log(`Analyzing logs from: ${SESSION_DIR}`);
        console.log(`Found ${files.length} session logs.`);
    }

    let totalSessions = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    const aggStats: Record<string, DailyStats> = {};

    for (const file of files) {
        const filePath = path.join(SESSION_DIR, file);
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let sessionDateObj: Date | null = null;
        let sessionInputTokens = 0;
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
                    if (event.data.model) {
                        sessionModel = event.data.model;
                    }
                }

                // Check other events for model info (just in case)
                if (event.type === 'session.info' && event.data.model) {
                    sessionModel = event.data.model;
                }

                // Input Tokens
                if (event.type === 'session.truncation') {
                    sessionInputTokens += (event.data.postTruncationTokensInMessages || 0);
                }

                // Output Tokens
                if (event.type === 'assistant.message') {
                    const content = event.data.content || "";
                    sessionOutputTokens += Math.ceil(content.length / 4);
                }

            } catch (e) {
                // Ignore parse errors
            }
        }

        if (sessionDateObj) {
            totalSessions++;
            totalInputTokens += sessionInputTokens;
            totalOutputTokens += sessionOutputTokens;

            // Determine pricing for this session
            let pricing = PRICING_TABLE[sessionModel] || PRICING_TABLE['default'];
            
            // Normalize model name check (case insensitive)
            const normalizedModel = sessionModel.toLowerCase();
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
    
    let sortedKeys = Object.keys(aggStats);
    if (rankByCost) {
        sortedKeys.sort((a, b) => aggStats[b].cost - aggStats[a].cost);
    } else {
        sortedKeys.sort();
    }

    for (const key of sortedKeys) {
        const stats = aggStats[key];
        console.log(`${key.padEnd(dateColWidth)} | ${stats.sessions.toString().padEnd(8)} | ${stats.input.toString().padEnd(12)} | ${stats.output.toString().padEnd(13)} | $${stats.cost.toFixed(4)}`);
    }
}

analyzeFiles().catch(console.error);