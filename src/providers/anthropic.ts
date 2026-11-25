import type { Message, ModelProvider, ModelRequest, ModelTurn } from "../types.js";
import { postJson, type FetchLike } from "./http.js";

export interface AnthropicOptions {
  apiKey?: string;
  model: string;
  maxTokens?: number;
  baseUrl?: string;
  fetch?: FetchLike;
}

/** Claude via the Anthropic Messages API, using plain fetch. */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;

  constructor(private readonly options: AnthropicOptions) {
    const key = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("AnthropicProvider needs an apiKey or ANTHROPIC_API_KEY");
    this.apiKey = key;
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const body = {
      model: this.options.model,
      max_tokens: this.options.maxTokens ?? 4096,
      ...(request.system ? { system: request.system } : {}),
      messages: toAnthropicMessages(request.messages),
      ...(request.tools.length
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    };

    const data = await postJson<AnthropicResponse>(
      `${this.options.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
      body,
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      { fetch: this.options.fetch, signal: request.signal },
    );

    let text = "";
    const toolCalls: ModelTurn["toolCalls"] = [];
    for (const block of data.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
    }
    return {
      text,
      toolCalls,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    };
  }
}

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

interface AnthropicResponse {
  content: AnthropicBlock[];
  usage?: { input_tokens: number; output_tokens: number };
}

export function toAnthropicMessages(messages: Message[]): unknown[] {
  return messages.map((m) => {
    switch (m.role) {
      case "user":
        return { role: "user", content: m.content };
      case "assistant":
        return {
          role: "assistant",
          content: [
            ...(m.text ? [{ type: "text", text: m.text }] : []),
            ...m.toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
          ],
        };
      case "tool":
        return {
          role: "user",
          content: m.results.map((r) => ({
            type: "tool_result",
            tool_use_id: r.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          })),
        };
    }
  });
}
