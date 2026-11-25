import type { JsonSchema, Tool, ToolContext } from "./types.js";

/**
 * Define a tool with light runtime validation: required fields must be
 * present and primitive types must match the schema before `execute` runs.
 */
export function defineTool<Input extends Record<string, unknown>>(tool: {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute(input: Input, context: ToolContext): Promise<unknown> | unknown;
}): Tool<Input> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) {
    throw new Error(`Invalid tool name "${tool.name}": use 1-64 letters, digits, "_" or "-"`);
  }
  return {
    ...tool,
    execute(input, context) {
      const problem = validateInput(tool.inputSchema, input);
      if (problem) throw new ToolInputError(problem);
      return tool.execute(input, context);
    },
  };
}

export class ToolInputError extends Error {
  override name = "ToolInputError";
}

const typeChecks: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
};

/** Returns a human-readable problem, or null when the input looks valid. */
export function validateInput(schema: JsonSchema, input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "Input must be a JSON object";
  }
  const record = input as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (record[key] === undefined) return `Missing required field "${key}"`;
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    const value = record[key];
    const expected = (spec as { type?: string; enum?: unknown[] }).type;
    const allowed = (spec as { enum?: unknown[] }).enum;
    if (value === undefined) continue;
    if (expected && typeChecks[expected] && !typeChecks[expected](value)) {
      return `Field "${key}" must be of type ${expected}`;
    }
    if (allowed && !allowed.includes(value)) {
      return `Field "${key}" must be one of: ${allowed.map(String).join(", ")}`;
    }
  }
  return null;
}
