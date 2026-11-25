import { test } from "node:test";
import assert from "node:assert/strict";
import { defineTool, MockProvider, runAgent } from "../src/index.js";

const add = defineTool<{ a: number; b: number }>({
  name: "add",
  description: "Add two numbers",
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  execute: ({ a, b }) => a + b,
});

test("returns the answer directly when no tools are called", async () => {
  const provider = new MockProvider([{ text: "Hello!" }]);
  const result = await runAgent({ provider, input: "Hi" });
  assert.equal(result.output, "Hello!");
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 1);
});

test("executes tool calls and feeds results back to the model", async () => {
  const provider = new MockProvider([
    { toolCalls: [{ id: "c1", name: "add", input: { a: 2, b: 3 } }] },
    (req) => {
      const last = req.messages.at(-1);
      assert.equal(last?.role, "tool");
      return { text: `The sum is ${last?.role === "tool" ? last.results[0]?.content : "?"}` };
    },
  ]);
  const result = await runAgent({ provider, tools: [add], input: "What is 2 + 3?" });
  assert.equal(result.output, "The sum is 5");
  assert.equal(result.steps, 2);
  assert.deepEqual(provider.requests[0]?.tools.map((t) => t.name), ["add"]);
});

test("runs parallel tool calls and keeps result order", async () => {
  const provider = new MockProvider([
    {
      toolCalls: [
        { id: "c1", name: "add", input: { a: 1, b: 1 } },
        { id: "c2", name: "add", input: { a: 10, b: 10 } },
      ],
    },
    { text: "done" },
  ]);
  const result = await runAgent({ provider, tools: [add], input: "go" });
  const toolMessage = result.messages.find((m) => m.role === "tool");
  assert.ok(toolMessage && toolMessage.role === "tool");
  assert.deepEqual(
    toolMessage.results.map((r) => [r.id, r.content]),
    [
      ["c1", "2"],
      ["c2", "20"],
    ],
  );
});

test("reports tool errors and invalid input back to the model instead of throwing", async () => {
  const boom = defineTool({
    name: "boom",
    description: "Always fails",
    inputSchema: { type: "object" },
    execute: () => {
      throw new Error("kaboom");
    },
  });
  const provider = new MockProvider([
    {
      toolCalls: [
        { id: "c1", name: "boom", input: {} },
        { id: "c2", name: "add", input: { a: "two", b: 3 } },
        { id: "c3", name: "missing", input: {} },
      ],
    },
    { text: "recovered" },
  ]);
  const result = await runAgent({ provider, tools: [add, boom], input: "go" });
  const toolMessage = result.messages.find((m) => m.role === "tool");
  assert.ok(toolMessage && toolMessage.role === "tool");
  assert.ok(toolMessage.results.every((r) => r.isError));
  assert.match(toolMessage.results[0]!.content, /kaboom/);
  assert.match(toolMessage.results[1]!.content, /"a" must be of type number/);
  assert.match(toolMessage.results[2]!.content, /unknown tool "missing"/);
  assert.equal(result.output, "recovered");
});

test("stops at maxSteps", async () => {
  const loop = { toolCalls: [{ id: "c", name: "add", input: { a: 1, b: 1 } }], text: "thinking" };
  const provider = new MockProvider([loop, loop, loop]);
  const result = await runAgent({ provider, tools: [add], input: "go", maxSteps: 3 });
  assert.equal(result.stopReason, "max_steps");
  assert.equal(result.steps, 3);
  assert.equal(result.output, "thinking");
});

test("truncates long tool results", async () => {
  const big = defineTool({
    name: "big",
    description: "Returns a lot of text",
    inputSchema: { type: "object" },
    execute: () => "x".repeat(100),
  });
  const provider = new MockProvider([{ toolCalls: [{ id: "c", name: "big", input: {} }] }, { text: "ok" }]);
  const result = await runAgent({ provider, tools: [big], input: "go", maxToolResultChars: 10 });
  const toolMessage = result.messages.find((m) => m.role === "tool");
  assert.ok(toolMessage && toolMessage.role === "tool");
  assert.match(toolMessage.results[0]!.content, /^x{10}\n…\[truncated 90 characters\]$/);
});

test("rejects duplicate tool names and invalid names", async () => {
  await assert.rejects(
    runAgent({ provider: new MockProvider([]), tools: [add, add], input: "go" }),
    /Duplicate tool name/,
  );
  assert.throws(
    () => defineTool({ name: "bad name", description: "", inputSchema: { type: "object" }, execute: () => 1 }),
    /Invalid tool name/,
  );
});

test("sums usage and emits events", async () => {
  const events: string[] = [];
  const provider = new MockProvider([
    { toolCalls: [{ id: "c", name: "add", input: { a: 1, b: 2 } }], usage: { inputTokens: 10, outputTokens: 5 } },
    { text: "3", usage: { inputTokens: 20, outputTokens: 1 } },
  ]);
  const result = await runAgent({ provider, tools: [add], input: "go", onEvent: (e) => events.push(e.type) });
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 6 });
  assert.deepEqual(events, ["model_turn", "tool_results", "model_turn"]);
});

test("honours an aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runAgent({ provider: new MockProvider([{ text: "x" }]), input: "go", signal: controller.signal }),
    { name: "AbortError" },
  );
});
