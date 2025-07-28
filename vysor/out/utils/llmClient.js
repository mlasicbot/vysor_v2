"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryASICLLM = queryASICLLM;
const ENDPOINT = "https://asicbot-instance.openai.azure.com/";
const DEPLOYMENT = "gpt-4o";
const API_VERSION = "2024-12-01-preview";
const API_KEY = "6rJo3Dtht0XscOMQBAT7xfvC53hcYtJQKTCJOHeKsmMe21P5wTi4JQQJ99BEAC77bzfXJ3w3AAABACOGk0KC"; // Replace securely or use env var in production
async function queryASICLLM(userQuery, context, messageHistory) {
    const systemPrompt = `You are ASIC LLM, a helpful assistant for hardware engineers. Respond with concise and accurate Verilog-centric answers.`;
    const fullPrompt = [
        { role: "system", content: systemPrompt },
        ...(messageHistory || []),
        {
            role: "user",
            content: context.length > 0
                ? `Context:\n${context.join('\n\n')}\n\nQuery:\n${userQuery}`
                : userQuery
        }
    ];
    const res = await fetch(`${ENDPOINT}openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "api-key": API_KEY
        },
        body: JSON.stringify({
            messages: fullPrompt,
            temperature: 0.3,
            max_tokens: 1024
        })
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`ASIC LLM Error: ${res.status} ${res.statusText}\n${errorText}`);
    }
    const json = await res.json();
    return json.choices[0]?.message?.content?.trim() ?? "(No response)";
}
//# sourceMappingURL=llmClient.js.map