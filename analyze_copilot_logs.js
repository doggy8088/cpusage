const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const SESSION_DIR = String.raw`C:\Users\wakau\.copilot\session-state`;

// Pricing Table (USD per 1M tokens)
const PRICING_TABLE = {
    'gpt-5-pro': { input: 15.00, output: 120.00 },
    'gpt-5-mini': { input: 0.25, output: 2.00 },
    'gpt-5-nano': { input: 0.05, output: 0.40 },
    'gpt-5': { input: 1.25, output: 10.00 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
    'default': { input: 1.25, output: 10.00 } // Defaulting to GPT-5
};

async function analyzeFiles() {
    if (!fs.existsSync(SESSION_DIR)) {
        console.error(`Directory not found: ${SESSION_DIR}`);
        return;
    }

    const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.jsonl'));
    console.log(`Found ${files.length} session logs.`);

    let totalSessions = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    const dailyStats = {};

    for (const file of files) {
        const filePath = path.join(SESSION_DIR, file);
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let sessionDate = null;
        let sessionInputTokens = 0;
        let sessionOutputTokens = 0;
        let sessionModel = 'default'; // Default model

        for await (const line of rl) {
            try {
                if (!line.trim()) continue;
                const event = JSON.parse(line);

                // Get Session Date
                if (event.type === 'session.start') {
                    const startTime = new Date(event.data.startTime);
                    sessionDate = startTime.toISOString().split('T')[0]; // YYYY-MM-DD
                    
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

        if (sessionDate) {
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

            if (!dailyStats[sessionDate]) {
                dailyStats[sessionDate] = { sessions: 0, input: 0, output: 0, cost: 0 };
            }
            dailyStats[sessionDate].sessions++;
            dailyStats[sessionDate].input += sessionInputTokens;
            dailyStats[sessionDate].output += sessionOutputTokens;
            dailyStats[sessionDate].cost += sessionCost;
        }
    }

    // Report
    console.log('\n=== Copilot CLI Chat Analysis (Dynamic Pricing) ===');
    console.log(`Total Sessions: ${totalSessions}`);
    console.log(`Total Input Tokens: ${totalInputTokens.toLocaleString()}`);
    console.log(`Total Output Tokens: ${totalOutputTokens.toLocaleString()}`);
    console.log(`Estimated Total Cost: $${totalCost.toFixed(4)}`);
    console.log(`(Default Model: GPT-5 @ $1.25/$10.00 per 1M tokens)`);

    console.log('\n=== Daily Breakdown ===');
    console.log('Date       | Sessions | Input Tokens | Output Tokens | Est. Cost');
    console.log('-----------|----------|--------------|---------------|----------');
    
    const sortedDates = Object.keys(dailyStats).sort();
    for (const date of sortedDates) {
        const stats = dailyStats[date];
        console.log(`${date} | ${stats.sessions.toString().padEnd(8)} | ${stats.input.toString().padEnd(12)} | ${stats.output.toString().padEnd(13)} | $${stats.cost.toFixed(4)}`);
    }
}

analyzeFiles().catch(console.error);