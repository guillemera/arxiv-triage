/**
 * Provider presets for the AI second opinion. None is preferred: the user picks one (or none).
 * Anthropic uses its own SDK; every other preset is an OpenAI-compatible Chat Completions API.
 * No SDK is imported here, so settings code and the options page can use this module cheaply.
 */

export const PROVIDER_IDS = [
  'none',
  'anthropic',
  'deepseek',
  'google',
  'groq',
  'mistral',
  'openai',
  'openrouter',
  'ollama',
  'lmstudio',
  'custom',
] as const;

export type LlmProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderPreset {
  id: Exclude<LlmProviderId, 'none'>;
  /** Shown in the provider selector. */
  label: string;
  /** Prefix of the reason in explanations, e.g. "Gemini: …"; null to use the model's name. */
  name: string | null;
  kind: 'anthropic' | 'openai-compatible';
  /** API base URL; empty for a custom server, where the user enters it. */
  baseUrl: string;
  needsKey: boolean;
  /** Where to create a key. */
  keyUrl?: string;
  /** Runs on this computer: free, and nothing leaves the machine. */
  local?: boolean;
  /** Optional parameters sent if the server accepts them (dropped automatically otherwise). */
  extraParams?: Record<string, unknown>;
  /** Where to start for structured output, when the provider is known not to take JSON schemas. */
  outputMode?: 'json_schema' | 'json_object';
  /** Answer-length cap, for servers whose default may be too short. */
  maxTokens?: { param: 'max_tokens' | 'max_completion_tokens'; value: number };
  /** Shown when the server answers 403 (e.g. a local server refusing browser extensions). */
  forbiddenHint?: string;
  /** A model to preselect, only where the provider documents a cheap, fast default. */
  suggestedModel?: string;
  note?: string;
}

const OLLAMA_ORIGINS_HINT =
  'Ollama refuses browser extensions unless you allow them: set OLLAMA_ORIGINS=chrome-extension://*,moz-extension://* and restart Ollama.';

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    name: 'Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    needsKey: true,
    keyUrl: 'https://platform.claude.com/settings/keys',
    suggestedModel: 'claude-haiku-5-5',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    needsKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    // No JSON-schema output; thinking is on by default and not needed here.
    outputMode: 'json_object',
    extraParams: { reasoning_effort: 'none' },
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    name: 'Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    extraParams: { reasoning_effort: 'low' },
  },
  {
    id: 'groq',
    label: 'Groq',
    name: null,
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    extraParams: { reasoning_effort: 'none' },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    extraParams: { reasoning_effort: 'low' },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (many models)',
    name: null,
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/settings/keys',
    // Route only to endpoints that support the requested output format; keep reasoning short.
    extraParams: { provider: { require_parameters: true }, reasoning: { effort: 'low', exclude: true } },
  },
  {
    id: 'ollama',
    label: 'Ollama (local, free)',
    name: null,
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    local: true,
    extraParams: { reasoning_effort: 'none' },
    // Ollama ignores max_completion_tokens.
    maxTokens: { param: 'max_tokens', value: 8192 },
    forbiddenHint: OLLAMA_ORIGINS_HINT,
    note: `Runs on this computer: start Ollama and pull a model first. ${OLLAMA_ORIGINS_HINT}`,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local, free)',
    name: null,
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    local: true,
    maxTokens: { param: 'max_tokens', value: 8192 },
    note: 'Runs on this computer: start LM Studio’s local server and load a model first.',
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible server',
    name: null,
    kind: 'openai-compatible',
    baseUrl: '',
    needsKey: false,
    note: 'Any server with an OpenAI-compatible /chat/completions endpoint.',
  },
];

export function preset(id: LlmProviderId): ProviderPreset | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** The base URL actually used: the user's override, or the preset's. */
export function baseUrlFor(id: LlmProviderId, override: string): string {
  return override.trim() || preset(id)?.baseUrl || '';
}

/** Host permission pattern for a base URL (match patterns ignore the port). */
export function originPattern(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** How explanations name the second opinion: the provider's model family, or the model itself. */
export function opinionName(id: LlmProviderId, model: string): string {
  const name = preset(id)?.name;
  if (name) return name;
  const short = model.split('/').pop()!.split(':')[0]!;
  return short || 'AI';
}
