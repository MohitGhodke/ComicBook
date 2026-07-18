export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface JsonSchemaSpec {
  /** A short name for the schema (required by the json_schema response format). */
  name: string;
  /** A JSON Schema object describing the expected response shape. */
  schema: Record<string, unknown>;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Constrain the reply to this JSON schema (server-side structured output). */
  schema?: JsonSchemaSpec;
  signal?: AbortSignal;
}
