import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, generateQuietPrompt } from "../../../../script.js";

const extensionName = "staged-thinking";

// Try multiple possible folder names
const possiblePaths = [
    "scripts/extensions/third-party/staged-thinking",
    "scripts/extensions/third-party/Stepped-thinking-test", 
    "scripts/extensions/third-party/stepped-thinking",
    "scripts/extensions/third-party/staged_thinking"
];

let extensionFolderPath = possiblePaths[0];

const defaultSettings = {
    enabled: true,
    showStages: true,
    maxTokensPerStage: 600,
    delayBetweenStages: 200
};

// State variables
let stagesData = null;
let isRunningStages = false;
let isOurQuietPrompt = false;
let pendingThinking = null;
let skipNextGeneration = true;  // Skip first generation after load/chat change
let lastProcessedMessageId = null;  // Track which message we already processed

// Load stages from JSON - tries multiple paths
async function loadStages() {
    for (const path of possiblePaths) {
        try {
            console.log(`[Staged Thinking] Trying to load from: ${path}/stages.json`);
            const response = await fetch(`${path}/stages.json`);
            
            if (!response.ok) {
                console.log(`[Staged Thinking] Path ${path} returned ${response.status}`);
                continue;
            }
            
            const data = await response.json();
            stagesData = data;
            extensionFolderPath = path;
            console.log(`[Staged Thinking] SUCCESS! Stages loaded from ${path}:`, data.stages.length, "stages");
            return data;
        } catch (error) {
            console.log(`[Staged Thinking] Path ${path} failed:`, error.message);
            continue;
        }
    }
    
    console.error("[Staged Thinking] FAILED to load stages.json from any known path!");
    return null;
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

// Run a single stage using ST's quiet generation with unique identifiers
async function runStage(stage, stageNumber, chatHistory) {
    const settings = extension_settings[extensionName];
    const timestamp = Date.now();
    const uniqueId = `${stageNumber}-${timestamp}`;
    
    const prompt = `[REQUEST ID: ${uniqueId}]
[TASK: TEMPLATE FILLING ONLY - NO ROLEPLAY]

You are filling in a planning template. DO NOT write story content.

=== YOUR TASK FOR STAGE ${stageNumber} ===
${substituteParams(stage.prompt)}

=== REFERENCE INFO (DO NOT ROLEPLAY) ===
${chatHistory.substring(0, 1000)}

=== OUTPUT INSTRUCTIONS ===
Fill in the template fields above. Output ONLY the filled template.
Do NOT write narrative. Do NOT continue the story. Just fill fields.`;

    console.log(`[Staged Thinking] Stage ${stageNumber} prompt length: ${prompt.length}`);
    console.log(`[Staged Thinking] Stage ${stageNumber} unique ID: ${uniqueId}`);

    try {
        isOurQuietPrompt = true;
        
        const result = await generateQuietPrompt({
            quietPrompt: prompt,
            quietImage: null,
            quietToLoud: false,
            skipWIAN: true,
            quietName: `Stage${stageNumber}`,
            maxTokens: settings.maxTokensPerStage
        });
        
        console.log(`[Staged Thinking] Stage ${stageNumber} result type: ${typeof result}`);
        console.log(`[Staged Thinking] Stage ${stageNumber} result length: ${result?.length || 0}`);
        console.log(`[Staged Thinking] Stage ${stageNumber} first 100 chars: ${result?.substring(0, 100)}`);
        
        return result;
    } catch (error) {
        console.error(`[Staged Thinking] Stage "${stage.name}" failed:`, error);
        return null;
    } finally {
        isOurQuietPrompt = false;
    }
}

// Main staged generation function
async function runStagedGeneration() {
    const settings = extension_settings[extensionName];
    
    if (!settings.enabled) {
        console.log("[Staged Thinking] Disabled, skipping");
        return null;
    }
    
    if (!stagesData) {
        console.error("[Staged Thinking] No stages data loaded");
        return null;
    }
    
    if (isRunningStages) {
        console.log("[Staged Thinking] Already running, skipping");
        return null;
    }
    
    isRunningStages = true;
    
    const chatHistory = getRecentChatHistory();
    let accumulatedThinking = "";
    const stageResults = [];
    
    console.log("[Staged Thinking] Beginning staged generation...");
    console.log("[Staged Thinking] Chat history length:", chatHistory.length, "chars");
    
    try {
        for (let i = 0; i < stagesData.stages.length; i++) {
            const stage = stagesData.stages[i];
            
            console.log(`[Staged Thinking] Running stage ${i + 1}/${stagesData.stages.length}: ${stage.name}`);
            
            const result = await runStage(stage, i + 1, chatHistory);
            
            if (result) {
                const stageOutput = `<think>\n[${stage.name}]\n${result}\n</think>`;
                stageResults.push({
                    name: stage.name,
                    content: result
                });
                accumulatedThinking += `\n\n${stageOutput}`;
                console.log(`[Staged Thinking] Stage ${stage.name} complete (${result.length} chars)`);
                
                if (settings.showStages) {
                    console.log(`[Staged Thinking] --- ${stage.name} OUTPUT ---`);
                    console.log(result.substring(0, 500) + (result.length > 500 ? "..." : ""));
                }
            } else {
                console.warn(`[Staged Thinking] Stage ${stage.name} returned no result, continuing...`);
            }
            
            if (settings.delayBetweenStages > 0 && i < stagesData.stages.length - 1) {
                await new Promise(resolve => setTimeout(resolve, settings.delayBetweenStages));
            }
        }
        
        console.log("[Staged Thinking] All stages complete. Total thinking:", accumulatedThinking.length, "chars");
        
        return {
            thinking: accumulatedThinking,
            stages: stageResults,
            finalPrompt: substituteParams(stagesData.finalPrompt)
        };
    } catch (error) {
        console.error("[Staged Thinking] Error during staged generation:", error);
        return null;
    } finally {
        isRunningStages = false;
    }
}

// Hook into generation events
function setupEventHooks() {
    // Reset state when chat changes (loading a chat, switching characters)
    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log("[Staged Thinking] Chat changed - will skip first generation");
        skipNextGeneration = true;
        lastProcessedMessageId = null;
        pendingThinking = null;
    });
    
    eventSource.on(event_types.GENERATION_STARTED, async () => {
        const settings = extension_settings[extensionName];
        if (!settings.enabled) return;
        
        // Skip if this is one of our own quiet prompt calls
        if (isOurQuietPrompt) {
            console.log("[Staged Thinking] Skipping - this is our own quiet prompt");
            return;
        }
        
        // Skip if already running stages
        if (isRunningStages) {
            console.log("[Staged Thinking] Already running stages, skipping");
            return;
        }
        
        // Skip first generation after chat load
        if (skipNextGeneration) {
            console.log("[Staged Thinking] Skipping first generation after chat load");
            skipNextGeneration = false;
            return;
        }
        
        const context = getContext();
        const chat = context.chat || [];
        
        if (chat.length === 0) {
            console.log("[Staged Thinking] Empty chat, skipping");
            return;
        }
        
        // Check if last message is from user
        const lastMessage = chat[chat.length - 1];
        if (!lastMessage.is_user) {
            console.log("[Staged Thinking] Last message not from user, skipping");
            return;
        }
        
        // Check if we already processed this exact message
        const messageId = lastMessage.send_date || `${chat.length}-${lastMessage.mes?.substring(0, 20)}`;
        if (messageId === lastProcessedMessageId) {
            console.log("[Staged Thinking] Already processed this message, skipping");
            return;
        }
        lastProcessedMessageId = messageId;
        
        console.log("[Staged Thinking] GENERATION_STARTED - running stages for user message...");
        
        try {
            const result = await runStagedGeneration();
            if (result && result.thinking) {
                pendingThinking = result;
                console.log("[Staged Thinking] Stages complete, thinking ready for injection");
            }
        } catch (error) {
            console.error("[Staged Thinking] Error in GENERATION_STARTED:", error);
            pendingThinking = null;
        }
    });
    
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
        const settings = extension_settings[extensionName];
        if (!settings.enabled || !pendingThinking) return;
        if (isOurQuietPrompt) return;
        
        console.log("[Staged Thinking] CHAT_COMPLETION_PROMPT_READY - injecting thinking...");
        
        try {
            const thinkingInjection = `[COMPLETED STAGED REASONING - YOU MUST FOLLOW THIS ANALYSIS]\n${pendingThinking.thinking}\n\n${pendingThinking.finalPrompt}`;
            
            if (data && data.chat) {
                data.chat.push({
                    role: "system",
                    content: thinkingInjection
                });
                console.log("[Staged Thinking] Injected into chat array");
            }
            
            pendingThinking = null;
        } catch (error) {
            console.error("[Staged Thinking] Error during injection:", error);
        }
    });
    
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (data) => {
        const settings = extension_settings[extensionName];
        if (!settings.enabled || !pendingThinking) return;
        if (isOurQuietPrompt) return;
        
        console.log("[Staged Thinking] GENERATE_BEFORE_COMBINE_PROMPTS - attempting injection...");
        
        try {
            if (data && typeof data.prompt === 'string') {
                data.prompt = `[COMPLETED STAGED REASONING]\n${pendingThinking.thinking}\n\n${pendingThinking.finalPrompt}\n\n${data.prompt}`;
                console.log("[Staged Thinking] Prepended to prompt string");
            }
        } catch (error) {
            console.error("[Staged Thinking] Error in GENERATE_BEFORE_COMBINE_PROMPTS:", error);
        }
    });
    
    eventSource.on(event_types.GENERATION_ENDED, () => {
        pendingThinking = null;
    });
}

// Slash command for manual testing
function registerSlashCommands() {
    try {
        const { registerSlashCommand } = window.SillyTavern?.getContext?.() || getContext();
        
        if (registerSlashCommand) {
            registerSlashCommand(
                "stagedthink",
                async (args, value) => {
                    console.log("[Staged Thinking] Manual trigger via /stagedthink");
                    const result = await runStagedGeneration();
                    if (result) {
                        console.log("[Staged Thinking] Manual run complete:");
                        console.log(result.thinking);
                        return `Staged thinking complete. ${result.stages.length} stages processed. Check console for output.`;
                    }
                    return "Staged thinking failed or is disabled.";
                },
                [],
                "Manually run staged thinking analysis without generating a response",
                true,
                true
            );
            console.log("[Staged Thinking] Slash command /stagedthink registered");
        }
    } catch (error) {
        console.warn("[Staged Thinking] Could not register slash command:", error);
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
                    <input id="staged_thinking_delay" type="number" min="0" max="2000" class="text_pole" />
                </div>
                <hr />
                <div class="staged-thinking-block">
                    <small><b>Stages:</b> Ground Truth → Reality Check → Strategy → Dialogue Check → Execution</small>
                </div>
                <div class="staged-thinking-block">
                    <small><b>Usage:</b> Type <code>/stagedthink</code> to test stages manually.</small>
                </div>
                <div class="staged-thinking-block">
                    <small style="color: orange;"><b>Note:</b> Makes 5 extra API calls per generation.</small>
                </div>
            </div>
        </div>
    </div>`;
    
    $("#extensions_settings").append(settingsHtml);
    
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
            settings.maxTokensPerStage = parseInt(this.value) || 600;
            saveSettingsDebounced();
        });
    
    $("#staged_thinking_delay")
        .val(settings.delayBetweenStages)
        .on("input", function() {
            settings.delayBetweenStages = parseInt(this.value) || 200;
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
    console.log("[Staged Thinking] Stages data:", stagesData ? `${stagesData.stages.length} stages` : "NOT LOADED");
});

export { runStagedGeneration };
