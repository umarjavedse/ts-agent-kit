import { test } from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider, OpenAIProvider, ProviderHttpError, type Message } from "../src/index.js";

const history: Message[] = [
  { role: "user", content: "Weather in Lahore?" },
  { role: "assistant", text: "Let me check.", toolCalls: [{ id: "t1", name: "weather", input: { city: "Lahore" } }] },
  { role: "tool", results: [{ id: "t1", name: "weather", content: "31°C, sunny", isError: false }] },
];
const tools = [
  { name: "weather", description: "Get weather", inputSchema: { type: "object" as const, properties: { city: { type: "string" } } } },
];

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { fetch, calls };
}

test("AnthropicProvider maps history, tools and tool_use blocks", async () => {
  const { fetch, calls } = fakeFetch([
    {
      status: 200,
      body: {
        content: [
          { type: "text", text: "Checking again." },
          { type: "tool_use", id: "t2", name: "weather", input: { city: "Karachi" } },
        ],
        usage: { input_tokens: 12, output_tokens: 7 },
      },
    },
  ]);
  const provider = new AnthropicProvider({ apiKey: "test", model: "claude-test", fetch });
  const turn = await provider.complete({ system: "Be brief", messages: history, tools });

  assert.equal(turn.text, "Checking again.");
  assert.deepEqual(turn.toolCalls, [{ id: "t2", name: "weather", input: { city: "Karachi" } }]);
  assert.deepEqual(turn.usage, { inputTokens: 12, outputTokens: 7 });

  const sent = JSON.parse(String(calls[0]!.init.body));
  assert.equal(calls[0]!.url, "https://api.anthropic.com/v1/messages");
  assert.equal((calls[0]!.init.headers as Record<string, string>)["x-api-key"], "test");
  assert.equal(sent.system, "Be brief");
  assert.equal(sent.tools[0].input_schema.type, "object");
  assert.deepEqual(sent.messages[1].content[1], { type: "tool_use", id: "t1", name: "weather", input: { city: "Lahore" } });
  assert.deepEqual(sent.messages[2], {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: "31°C, sunny" }],
  });
});

test("OpenAIProvider maps history, tools and tool_calls", async () => {
  const { fetch, calls } = fakeFetch([
    {
      status: 200,
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "t2", function: { name: "weather", arguments: '{"city":"Karachi"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4 },
      },
    },
  ]);
  const provider = new OpenAIProvider({ apiKey: "test", model: "gpt-test", fetch });
  const turn = await provider.complete({ system: "Be brief", messages: history, tools });

  assert.equal(turn.text, "");
  assert.deepEqual(turn.toolCalls, [{ id: "t2", name: "weather", input: { city: "Karachi" } }]);

  const sent = JSON.parse(String(calls[0]!.init.body));
  assert.deepEqual(sent.messages[0], { role: "system", content: "Be brief" });
  assert.equal(sent.messages[2].tool_calls[0].function.arguments, '{"city":"Lahore"}');
  assert.deepEqual(sent.messages[3], { role: "tool", tool_call_id: "t1", content: "31°C, sunny" });
  assert.equal(sent.tools[0].function.name, "weather");
});

test("retries rate limits, then surfaces non-retryable errors", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 429, body: { error: "slow down" } },
    { status: 200, body: { content: [{ type: "text", text: "ok" }] } },
  ]);
  const provider = new AnthropicProvider({ apiKey: "k", model: "m", fetch });
  // retry-after is absent, so the default 500 ms backoff applies once.
  const turn = await provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] });
  assert.equal(turn.text, "ok");
  assert.equal(calls.length, 2);

  const failing = fakeFetch([{ status: 400, body: { error: "bad request" } }]);
  const bad = new OpenAIProvider({ apiKey: "k", model: "m", fetch: failing.fetch });
  await assert.rejects(bad.complete({ messages: [{ role: "user", content: "hi" }], tools: [] }), (error) => {
    assert.ok(error instanceof ProviderHttpError);
    assert.equal(error.status, 400);
    return true;
  });
});

test("providers require an API key", () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => new AnthropicProvider({ model: "m" }), /ANTHROPIC_API_KEY/);
    assert.throws(() => new OpenAIProvider({ model: "m" }), /OPENAI_API_KEY/);
  } finally {
    if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.o) process.env.OPENAI_API_KEY = saved.o;
  }
});
