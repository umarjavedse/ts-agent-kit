import type { Message, ModelProvider, ModelRequest, ModelTurn } from "../types.js";
import { postJson, type FetchLike } from "./http.js";

export interface OpenAIOptions {
  apiKey?: string;
  model: string;
  /** Point at any OpenAI-compatible endpoint (Azure, local servers, gateways). */
  baseUrl?: string;
  fetch?: FetchLike;
}

/** OpenAI (or any compatible server) via the Chat Completions API. */
export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private readonly apiKey: string;

  constructor(private readonly options: OpenAIOptions) {
    const key = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OpenAIProvider needs an apiKey or OPENAI_API_KEY");
    this.apiKey = key;
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const body = {
      model: this.options.model,
      messages: toOpenAIMessages(request.system, request.messages),
      ...(request.tools.length
        ? {
            tools: request.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
    };

    const data = await postJson<OpenAIResponse>(
      `${this.options.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`,
      body,
      { authorization: `Bearer ${this.apiKey}` },
      { fetch: this.options.fetch, signal: request.signal },
    );

    const message = data.choices[0]?.message;
    if (!message) throw new Error("OpenAI response had no choices");
    return {
      text: message.content ?? "",
      toolCalls: (message.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        input: parseArguments(c.function.arguments),
      })),
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

interface OpenAIResponse {
  choices: {
    message: {
      content: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Malformed JSON from the model: hand the raw text to the tool so validation reports it.
    return { _raw: raw };
  }
}

export function toOpenAIMessages(system: string | undefined, messages: Message[]): unknown[] {
  const out: unknown[] = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
    }
    if (m.role === "tool") {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: r.content });
    }
  }
  return out;
}
