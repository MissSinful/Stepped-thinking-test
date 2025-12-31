import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { oai_settings } from "../../../openai.js";

const extensionName = "staged-thinking";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const defaultSettings = {
    enabled: true,
    showStages: true,
    maxTokensPerStage: 500,
    delayBetweenStages: 100
};

let stagesData = null;

// Load stages from JSON
async function loadStages() {
    try {
        const response = await fetch(`${extensionFolderPath}/stages.json`);
        const data = await response.json();
        stagesData = data;
        console.log("[Staged Thinking] Stages loaded:", data.stages.length);
        return data;
    } catch (error) {
        console.error("[Staged Thinking] Failed to load stages:", error);
        return null;
    }
}

// Initialize settings
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
}

// Replace {{char}} and {{user}} in prompts
function substituteParams(text) {
    const context = getContext();
    const charName = context.characters[context.characterId]?.name || "Character";
    const userName = context.name1 || "User";
    
    return text
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{user\}\}/gi, userName);
}

// Get recent chat history for context
function getRecentChatHistory(maxMessages = 10) {
    const context = getContext();
    const chat = context.chat || [];
    const recent = chat.slice(-maxMessages);
    
    return recent.map(msg => {
        const name = msg.is_user ? context.name1 : context.characters[context.characterId]?.name;
        return `${name}: ${msg.mes}`;
    }).join("\n\n");
}

// Make a raw API call for a single stage
async function callStageAPI(systemPrompt, userPrompt) {
    const context = getContext();
    const settings = extension_settings[extensionName];
    
    // Build the request based on current API settings
    const apiUrl = oai_settings.custom_url || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
    
    const requestBody = {
        model: oai_settings.custom_model || "glm-4-plus",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: settings.maxTokensPerStage,
        temperature: 0.7
    };
    
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${oai_settings.api_key_custom || oai_settings.api_key}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`API call failed: ${response.status}`);
        }
        
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (error) {
        console.error("[Staged Thinking] API call error:", error);
        return null;
    }
}

// Run a single stage
async function runStage(stage, previousThinking, chatHistory) {
    const systemPrompt = `You are performing staged reasoning for roleplay. Complete ONLY the current analysis stage. Be thorough but concise. Do not write the actual narrative yet - only complete the analysis requested.

${previousThinking ? `Previous thinking stages:\n${previousThinking}` : "(This is the first stage)"}`;

    const userPrompt = `${substituteParams(stage.prompt)}

Recent chat context:
${chatHistory}`;
    
    return await callStageAPI(systemPrompt, userPrompt);
}

// Main staged generation function
async function runStagedGeneration() {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || !stagesData) return null;
    
    const chatHistory = getRecentChatHistory();
    let accumulatedThinking = "";
    const stageResults = [];
    
    console.log("[Staged Thinking] Beginning staged generation...");
    
    // Run each thinking stage
    for (let i = 0; i < stagesData.stages.length; i++) {
        const stage = stagesData.stages[i];
        
        console.log(`[Staged Thinking] Running stage ${i + 1}/${stagesData.stages.length}: ${stage.name}`);
        
        const result = await runStage(stage, accumulatedThinking, chatHistory);
        
        if (result) {
            const stageOutput = `<think>\n[${stage.name}]\n${result}\n</think>`;
            stageResults.push({
                name: stage.name,
                content: result
            });
            accumulatedThinking += `\n\n${stageOutput}`;
            console.log(`[Staged Thinking] Stage ${stage.name} complete`);
        } else {
            console.warn(`[Staged Thinking] Stage ${stage.name} returned no result`);
        }
        
        // Small delay between stages
        if (settings.delayBetweenStages > 0 && i < stagesData.stages.length - 1) {
            await new Promise(resolve => setTimeout(resolve, settings.delayBetweenStages));
        }
    }
    
    console.log("[Staged Thinking] All stages complete");
    
    return {
        thinking: accumulatedThinking,
        stages: stageResults,
        finalPrompt: substituteParams(stagesData.finalPrompt)
    };
}

// Hook into chat completion
function setupEventHooks() {
    // Intercept before the main generation
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, async (data) => {
        const settings = extension_settings[extensionName];
        if (!settings.enabled) return data;
        
        try {
            console.log("[Staged Thinking] Intercepting generation...");
            const stagedResult = await runStagedGeneration();
            
            if (stagedResult && stagedResult.thinking) {
                // Inject the completed thinking into the messages
                const thinkingMessage = {
                    role: "system",
                    content: `[COMPLETED STAGED REASONING - FOLLOW THIS ANALYSIS]\n${stagedResult.thinking}\n\n${stagedResult.finalPrompt}`
                };
                
                // Add to messages array
                if (data.body && data.body.messages) {
                    // Insert before the last user message
                    const lastUserIndex = data.body.messages.map(m => m.role).lastIndexOf("user");
                    if (lastUserIndex > -1) {
                        data.body.messages.splice(lastUserIndex, 0, thinkingMessage);
                    } else {
                        data.body.messages.push(thinkingMessage);
                    }
                }
                
                console.log("[Staged Thinking] Injected thinking into generation");
            }
        } catch (error) {
            console.error("[Staged Thinking] Hook error:", error);
        }
        
        return data;
    });
}

// Alternative: Slash command to manually trigger
function registerSlashCommands() {
    const context = getContext();
    
    if (context.registerSlashCommand) {
        context.registerSlashCommand("stagedthink", async () => {
            const result = await runStagedGeneration();
            if (result) {
                console.log("[Staged Thinking] Manual run complete:");
                console.log(result.thinking);
                return result.thinking;
            }
            return "Staged thinking failed or is disabled.";
        }, [], "Manually run staged thinking analysis", true, true);
    }
}

// Settings UI
async function loadSettingsUI() {
    const settingsHtml = `
    <div class="staged-thinking-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Staged Thinking</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="staged-thinking-block flex-container">
                    <label class="checkbox_label flexGrow">
                        <input id="staged_thinking_enabled" type="checkbox" />
                        <span>Enable Staged Thinking</span>
                    </label>
                </div>
                <div class="staged-thinking-block flex-container">
                    <label class="checkbox_label flexGrow">
                        <input id="staged_thinking_show_stages" type="checkbox" />
                        <span>Show Thinking Stages in Console</span>
                    </label>
                </div>
                <div class="staged-thinking-block">
                    <label for="staged_thinking_max_tokens">Max Tokens Per Stage</label>
                    <input id="staged_thinking_max_tokens" type="number" min="100" max="2000" class="text_pole" />
                </div>
                <div class="staged-thinking-block">
                    <label for="staged_thinking_delay">Delay Between Stages (ms)</label>
                    <input id="staged_thinking_delay" type="number" min="0" max="1000" class="text_pole" />
                </div>
                <hr />
                <div class="staged-thinking-block">
                    <small>
                        <b>Stages:</b> Ground Truth → Reality Check → Strategy → Dialogue Check → Execution → Final Narrative
                    </small>
                </div>
                <div class="staged-thinking-block">
                    <small>
                        <b>Note:</b> This extension makes 5 additional API calls per generation to run each thinking stage separately.
                    </small>
                </div>
            </div>
        </div>
    </div>`;
    
    $("#extensions_settings").append(settingsHtml);
    
    // Bind UI elements
    const settings = extension_settings[extensionName];
    
    $("#staged_thinking_enabled")
        .prop("checked", settings.enabled)
        .on("change", function() {
            settings.enabled = this.checked;
            saveSettingsDebounced();
            console.log("[Staged Thinking] Enabled:", settings.enabled);
        });
    
    $("#staged_thinking_show_stages")
        .prop("checked", settings.showStages)
        .on("change", function() {
            settings.showStages = this.checked;
            saveSettingsDebounced();
        });
    
    $("#staged_thinking_max_tokens")
        .val(settings.maxTokensPerStage)
        .on("input", function() {
            settings.maxTokensPerStage = parseInt(this.value) || 500;
            saveSettingsDebounced();
        });
    
    $("#staged_thinking_delay")
        .val(settings.delayBetweenStages)
        .on("input", function() {
            settings.delayBetweenStages = parseInt(this.value) || 100;
            saveSettingsDebounced();
        });
}

// Initialize extension
jQuery(async () => {
    console.log("[Staged Thinking] Initializing...");
    
    loadSettings();
    await loadStages();
    await loadSettingsUI();
    setupEventHooks();
    registerSlashCommands();
    
    console.log("[Staged Thinking] Extension loaded successfully");
});

export { runStagedGeneration };
