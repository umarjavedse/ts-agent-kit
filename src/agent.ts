import type { Message, ModelProvider, Tool, ToolCall, ToolResult } from "./types.js";

export interface RunAgentOptions {
  provider: ModelProvider;
  tools?: Tool[];
  system?: string;
  /** The user's message, or a full history to continue from. */
  input: string | Message[];
  /** Maximum model calls before stopping. Default 10. */
  maxSteps?: number;
  /** Maximum characters of a tool result sent back to the model. Default 20,000. */
  maxToolResultChars?: number;
  signal?: AbortSignal;
  /** Called after every model turn and every batch of tool results. */
  onEvent?: (event: AgentEvent) => void;
}

export type AgentEvent =
  | { type: "model_turn"; step: number; text: string; toolCalls: ToolCall[] }
  | { type: "tool_results"; step: number; results: ToolResult[] };

export interface AgentResult {
  /** The model's final text answer. */
  output: string;
  /** "done" when the model answered, "max_steps" when the step budget ran out. */
  stopReason: "done" | "max_steps";
  steps: number;
  messages: Message[];
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Run the classic agent loop: call the model, execute any tools it asks
 * for (in parallel), feed the results back, and repeat until it answers.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const {
    provider,
    tools = [],
    system,
    maxSteps = 10,
    maxToolResultChars = 20_000,
    signal,
    onEvent,
  } = options;

  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`Duplicate tool name "${tool.name}"`);
    names.add(tool.name);
  }
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const toolSpecs = tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));

  const messages: Message[] =
    typeof options.input === "string"
      ? [{ role: "user", content: options.input }]
      : [...options.input];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let step = 1; step <= maxSteps; step++) {
    signal?.throwIfAborted();
    const turn = await provider.complete({ system, messages, tools: toolSpecs, signal });
    usage.inputTokens += turn.usage?.inputTokens ?? 0;
    usage.outputTokens += turn.usage?.outputTokens ?? 0;

    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });
    onEvent?.({ type: "model_turn", step, text: turn.text, toolCalls: turn.toolCalls });

    if (turn.toolCalls.length === 0) {
      return { output: turn.text, stopReason: "done", steps: step, messages, usage };
    }

    const results = await Promise.all(
      turn.toolCalls.map((call) => executeCall(call, toolsByName, maxToolResultChars, signal)),
    );
    messages.push({ role: "tool", results });
    onEvent?.({ type: "tool_results", step, results });
  }

  const last = messages.findLast((m) => m.role === "assistant");
  return {
    output: last && last.role === "assistant" ? last.text : "",
    stopReason: "max_steps",
    steps: maxSteps,
    messages,
    usage,
  };
}

async function executeCall(
  call: ToolCall,
  tools: Map<string, Tool>,
  maxChars: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const tool = tools.get(call.name);
  if (!tool) {
    return { id: call.id, name: call.name, content: `Error: unknown tool "${call.name}"`, isError: true };
  }
  try {
    const value = await tool.execute(call.input, { signal });
    return { id: call.id, name: call.name, content: truncate(stringify(value), maxChars), isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Errors go back to the model so it can correct itself instead of crashing the run.
    return { id: call.id, name: call.name, content: `Error: ${message}`, isError: true };
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} characters]`;
}
