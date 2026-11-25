/**
 * Run with a real model:
 *   ANTHROPIC_API_KEY=... MODEL=<claude model id> npm run example
 *   OPENAI_API_KEY=...    MODEL=<openai model id> npm run example
 * Without a key it runs against a scripted MockProvider.
 */
import { AnthropicProvider, defineTool, MockProvider, OpenAIProvider, runAgent, type ModelProvider } from "../src/index.js";

const getWeather = defineTool<{ city: string; unit?: "c" | "f" }>({
  name: "get_weather",
  description: "Get the current weather for a city",
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name, e.g. Lahore" },
      unit: { type: "string", enum: ["c", "f"] },
    },
    required: ["city"],
  },
  // A stand-in for a real weather API.
  execute: ({ city, unit = "c" }) => ({ city, temperature: unit === "c" ? 24 : 75, unit, conditions: "clear" }),
});

function pickProvider(): ModelProvider {
  const model = process.env.MODEL;
  if (process.env.ANTHROPIC_API_KEY && model) return new AnthropicProvider({ model });
  if (process.env.OPENAI_API_KEY && model) return new OpenAIProvider({ model });
  console.log("No API key/MODEL set, using the scripted MockProvider.\n");
  return new MockProvider([
    { toolCalls: [{ id: "call_1", name: "get_weather", input: { city: "Lahore" } }] },
    { text: "It's 24°C and clear in Lahore right now." },
  ]);
}

const result = await runAgent({
  provider: pickProvider(),
  tools: [getWeather],
  system: "You are a concise assistant. Use tools when they help.",
  input: "What's the weather in Lahore?",
  onEvent: (event) => {
    if (event.type === "model_turn") {
      for (const call of event.toolCalls) console.log(`→ ${call.name}(${JSON.stringify(call.input)})`);
    } else {
      for (const r of event.results) console.log(`← ${r.content}`);
    }
  },
});

console.log(`\n${result.output}\n(${result.steps} steps, ${result.usage.inputTokens + result.usage.outputTokens} tokens)`);
