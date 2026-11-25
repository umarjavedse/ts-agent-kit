# ts-agent-kit

[![CI](https://github.com/umarjavedse/ts-agent-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/umarjavedse/ts-agent-kit/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

A tiny, **dependency-free** TypeScript agent loop with tool calling for **Claude (Anthropic)** and **OpenAI**.

It is the core loop behind most AI agents, without a framework around it: call the model, run the tools it asks for, feed the results back, repeat until it answers. Small enough to read in one sitting, and tested offline with a scripted mock model.

## Features

- **One loop, two providers.** The same tools and conversation work with the Anthropic Messages API and the OpenAI Chat Completions API (or any OpenAI-compatible server).
- **Parallel tool calls.** Tools requested in the same turn run concurrently, and results keep their order.
- **Self-correcting errors.** Tool exceptions, invalid input and unknown tools go back to the model as error results instead of crashing the run.
- **Input validation.** Required fields, primitive types and enums are checked against each tool's JSON Schema.
- **Production guards.** Step budget, tool-result truncation, `AbortSignal` cancellation, retries with backoff on 429/5xx, and token usage totals.
- **Testable.** `MockProvider` scripts model turns and records every request, so agent logic is unit-tested without network calls.

## Quick start

```bash
git clone https://github.com/umarjavedse/ts-agent-kit.git
cd ts-agent-kit
npm install
npm test          # 13 offline tests
npm run example   # mock model; set ANTHROPIC_API_KEY or OPENAI_API_KEY plus MODEL for a real one
```

## Usage

```ts
import { AnthropicProvider, defineTool, runAgent } from "ts-agent-kit";

const getWeather = defineTool<{ city: string }>({
  name: "get_weather",
  description: "Get the current weather for a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
  execute: async ({ city }) => fetchWeather(city),
});

const result = await runAgent({
  provider: new AnthropicProvider({ model: "<claude-model-id>" }), // reads ANTHROPIC_API_KEY
  tools: [getWeather],
  system: "You are a concise assistant.",
  input: "What's the weather in Lahore?",
  maxSteps: 8,
  onEvent: (e) => console.log(e.type),
});

console.log(result.output, result.usage);
```

Switching to OpenAI is one line:

```ts
import { OpenAIProvider } from "ts-agent-kit";
const provider = new OpenAIProvider({ model: "<openai-model-id>" }); // reads OPENAI_API_KEY
```

## How it works

```
user input ─► model ─► tool calls? ──no──► final answer
                ▲          │ yes
                │          ▼
                └── tool results (run in parallel, errors included)
```

Conversation history is stored in a provider-neutral format (`user`, `assistant` with tool calls, `tool` results). Each provider maps it to its own wire format, so you can swap models mid-project without touching agent code.

## Testing your own agents

```ts
import { MockProvider, runAgent } from "ts-agent-kit";

const provider = new MockProvider([
  { toolCalls: [{ id: "1", name: "get_weather", input: { city: "Lahore" } }] },
  { text: "It's sunny." },
]);
const result = await runAgent({ provider, tools: [getWeather], input: "Weather?" });
// provider.requests holds every request the agent sent
```

## Project layout

```
src/
  agent.ts            the agent loop
  tool.ts             defineTool + input validation
  types.ts            provider-neutral types
  providers/          anthropic.ts, openai.ts, mock.ts, http.ts (fetch + retries)
test/                 node:test suites (no network)
examples/             runnable weather agent
```

## License

MIT © Umar Javed
