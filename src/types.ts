/** A JSON Schema object describing a tool's input. */
export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/** A tool the model can call. */
export interface Tool<Input = any> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute(input: Input, context: ToolContext): Promise<unknown> | unknown;
}

export interface ToolContext {
  /** Aborted when the agent run is cancelled. */
  signal?: AbortSignal;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

/** Provider-neutral conversation history. */
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface ModelRequest {
  system?: string;
  messages: Message[];
  tools: Pick<Tool, "name" | "description" | "inputSchema">[];
  signal?: AbortSignal;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

/** Anything that can turn a conversation into the model's next turn. */
export interface ModelProvider {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelTurn>;
}
