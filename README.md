# Staged Thinking Extension for SillyTavern

A SillyTavern extension that forces true interleaved/staged thinking by making separate API calls for each reasoning stage before generating the final narrative response.

## The Problem

When using CoT (Chain of Thought) prompts, models often ignore instructions to close and reopen `<think>` tags between stages. They dump everything into one massive thinking block, which defeats the purpose of staged reasoning.

## The Solution

This extension intercepts generation and runs **5 separate API calls** - one for each thinking stage:

1. **Ground Truth** - Scene state, character emotions, context gathering
2. **Reality Check** - Plausibility adjudication, consequence simulation
3. **Strategy** - Goal selection (max 2 beats), narrative planning
4. **Dialogue Check** - Enforces single-beat dialogue rule
5. **Execution** - Final checks, formatting, polish

Only after all stages complete does it generate the actual narrative response.

## Features

- **True staged thinking** - Each stage is a separate API call
- **Configurable** - Adjust tokens per stage, delays between calls
- **Dialogue discipline** - Built-in TWO-BEAT RULE enforcement
- **Customizable stages** - Edit `stages.json` to modify prompts

## Installation

1. Navigate to your SillyTavern extensions folder:
   ```
   SillyTavern/public/scripts/extensions/third-party/
   ```

2. Clone this repository:
   ```bash
   git clone https://github.com/MissSinful/Stepped-thinking-test.git staged-thinking
   ```

3. Restart SillyTavern

4. Enable the extension in the Extensions panel

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| Enable Staged Thinking | Turn the extension on/off | On |
| Show Thinking Stages | Log stages to console | On |
| Max Tokens Per Stage | Token limit for each thinking stage | 500 |
| Delay Between Stages | Milliseconds to wait between API calls | 100 |

## Usage Notes

- This extension makes **5 additional API calls** per generation
- Works best with models that support long context (the thinking accumulates)
- Designed for use with GLM-4, but should work with any OpenAI-compatible API
- Disable your preset's built-in CoT/prefill when using this extension

## Customizing Stages

Edit `stages.json` to modify the thinking prompts. Each stage has:
- `name` - Display name for the stage
- `prompt` - The actual prompt sent to the model

The `finalPrompt` is appended after all stages complete to trigger narrative generation.

## The Two-Beat Rule

This extension enforces a key anti-chattiness rule:

> The entire response contains a maximum of TWO content beats (e.g., internal reaction + one spoken line, OR action + question). Not three. Not four. Two, then stop. Leave room for the user to respond.

## Credits

- Extension concept and prompts based on the Sushi Preset
- Built for use with Zhipu GLM-4.7 API

## License

MIT
