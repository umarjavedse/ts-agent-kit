import type { ModelProvider, ModelRequest, ModelTurn } from "../types.js";

type ScriptedTurn = Partial<ModelTurn> | ((request: ModelRequest) => Partial<ModelTurn>);

/**
 * A scripted model for tests and demos: returns the given turns in order.
 * Every request is recorded in `requests` so tests can assert on them.
 */
export class MockProvider implements ModelProvider {
  readonly name = "mock";
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly turns: ScriptedTurn[]) {}

  async complete(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(structuredClone({ ...request, signal: undefined }));
    const script = this.turns[this.index++];
    if (!script) throw new Error(`MockProvider ran out of scripted turns at call ${this.index}`);
    const turn = typeof script === "function" ? script(request) : script;
    return { text: turn.text ?? "", toolCalls: turn.toolCalls ?? [], usage: turn.usage };
  }
}
