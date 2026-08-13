import {
  JobParserError,
  type JobParserConfig,
  type ParsedJobFields,
} from '../types.js';
import { sanitizeVacancyText } from '../utils/text.js';
import { normalizeOpenRouterJobFields } from './normalize.js';

const DEFAULT_MODEL = 'inclusionai/ling-3.0-flash';
const OPENROUTER_CHAT_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_BACKOFF_MS = [1_000, 2_500, 5_000];
const TEXT_LIMIT = 20_000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TOP_P = 0.95;
const DEFAULT_TOP_K = 20;
const DEFAULT_MAX_TOKENS = 8_192;
const DEFAULT_TIMEOUT_MS = 90_000;

export type OpenRouterClient = {
  apiKey: string;
  model: string;
};

let initializedOpenRouterClient: OpenRouterClient | null = null;

type OpenRouterJsonRequest = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (status === 429) {
    return true;
  }

  return stringifyError(error).toLowerCase().includes('429');
}

function createHttpError(status: number, body: string): Error {
  const error = new Error(`OpenRouter HTTP ${status}: ${body.slice(0, 2000)}`);
  (error as { status?: number }).status = status;
  return error;
}

function stripThinkTags(text: string): string {
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim();
}

function extractMessageText(payload: unknown): string {
  const record = payload as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>;
      };
    }>;
  };
  const content = record.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return stripThinkTags(content);
  }

  if (Array.isArray(content)) {
    return stripThinkTags(
      content
        .map((part) => part.text ?? '')
        .join(''),
    );
  }

  return '';
}

function stripCodeFences(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fencedMatch?.[1]?.trim() || text.trim();
}

function extractJsonObject(text: string): string {
  const trimmed = stripCodeFences(text);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new JobParserError(
      'OPENROUTER_INVALID_JSON',
      'OpenRouter response does not contain a JSON object.',
    );
  }
  return trimmed.slice(start, end + 1);
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
  ) {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function createOpenRouterClient(config: JobParserConfig): OpenRouterClient {
  const apiKey = config.openRouterApiKey?.trim();
  if (!apiKey) {
    throw new JobParserError(
      'OPENROUTER_API_KEY_MISSING',
      'OpenRouter API key is not configured. Initialize job-parser with a valid openRouterApiKey.',
    );
  }

  return {
    apiKey,
    model: config.llmModel?.trim() || DEFAULT_MODEL,
  };
}

export function initializeOpenRouterClient(config: JobParserConfig): void {
  initializedOpenRouterClient = createOpenRouterClient(config);
}

export function resetOpenRouterClientForTests(): void {
  initializedOpenRouterClient = null;
}

function getInitializedOpenRouterClient(): OpenRouterClient {
  if (!initializedOpenRouterClient) {
    throw new JobParserError(
      'OPENROUTER_API_KEY_MISSING',
      'Job parser is not initialized. Call initializeJobParser({ openRouterApiKey, llmModel? }) before parseJob().',
    );
  }

  return initializedOpenRouterClient;
}

async function requestOpenRouterJsonObject<T extends Record<string, unknown>>(
  client: OpenRouterClient,
  request: OpenRouterJsonRequest,
): Promise<T> {
  for (let attempt = 0; attempt <= DEFAULT_BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: timeoutSignal(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        body: JSON.stringify({
          model: client.model,
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
          top_p: request.topP ?? DEFAULT_TOP_P,
          top_k: request.topK ?? DEFAULT_TOP_K,
          ...(request.maxTokens !== undefined
            ? { max_tokens: request.maxTokens }
            : {}),
          reasoning: {
            enabled: false,
            effort: 'none',
          },
          chat_template_kwargs: {
            enable_thinking: false,
          },
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: request.systemPrompt,
            },
            {
              role: 'user',
              content: request.userPrompt,
            },
          ],
        }),
      });

      const body = await response.text();
      if (!response.ok) {
        throw createHttpError(response.status, body);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new JobParserError(
          'OPENROUTER_RESPONSE_NOT_JSON',
          `OpenRouter returned non-JSON response: ${body.slice(0, 2000)}`,
        );
      }

      const content = extractMessageText(payload);
      if (!content) {
        throw new JobParserError(
          'OPENROUTER_EMPTY_RESPONSE',
          'OpenRouter response did not include message content.',
        );
      }

      try {
        return JSON.parse(extractJsonObject(content)) as T;
      } catch (error) {
        if (error instanceof JobParserError) {
          throw error;
        }
        throw new JobParserError(
          'OPENROUTER_INVALID_JSON',
          `OpenRouter returned invalid JSON content: ${content.slice(0, 2000)}`,
        );
      }
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= DEFAULT_BACKOFF_MS.length) {
        if (error instanceof JobParserError) {
          throw error;
        }
        throw new JobParserError('OPENROUTER_REQUEST_FAILED', stringifyError(error));
      }
      await sleep(DEFAULT_BACKOFF_MS[attempt]);
    }
  }

  throw new JobParserError(
    'OPENROUTER_REQUEST_FAILED',
    'OpenRouter request failed after retries.',
  );
}

export async function extractJobFieldsWithOpenRouter(
  rawText: string,
): Promise<ParsedJobFields> {
  const client = getInitializedOpenRouterClient();
  const truncatedText = rawText.slice(0, TEXT_LIMIT);
  const payload = await requestOpenRouterJsonObject<Record<string, unknown>>(client, {
    temperature: DEFAULT_TEMPERATURE,
    topP: DEFAULT_TOP_P,
    topK: DEFAULT_TOP_K,
    maxTokens: DEFAULT_MAX_TOKENS,
    systemPrompt:
      'You extract job posting fields. Return only one valid JSON object with no markdown or explanations.',
    userPrompt: [
      'Extract the job posting fields from the text below.',
      'Return JSON with exactly these keys:',
      '- companyName: string',
      '- positionTitle: string',
      '- salary: string with the advertised compensation or pay range, empty string if absent',
      '- location: string with the advertised work location or remote/hybrid status, empty string if absent',
      '- jobDescription: string containing the full job-specific vacancy description from the source',
      '- warnings: string[] for uncertainty, missing data, or suspicious extraction',
      '',
      'For jobDescription:',
      '- Return the complete role-specific description in readable plain text.',
      '- Include intro/context, responsibilities, requirements, qualifications, benefits, compensation, location, and work-format notes when present.',
      '- Preserve the source meaning and coverage; do not summarize, shorten, paraphrase, rewrite, or select only the important bullets.',
      '- Do not return only responsibilities, requirements, qualifications, benefits, compensation, or any other single section.',
      '- Exclude navigation, footer, cookie banners, apply form fields, unrelated company marketing blocks, duplicated noise, and page chrome.',
      '',
      'Do not invent company, role, salary, or location values. If a field is absent, return an empty string and explain it in warnings.',
      '',
      'Text:',
      truncatedText,
    ].join('\n'),
  });

  const fields = normalizeOpenRouterJobFields(payload, rawText);
  if (rawText.length > TEXT_LIMIT) {
    fields.jobDescription = sanitizeVacancyText(rawText) || rawText.trim();
    fields.warnings = [
      ...new Set([
        ...fields.warnings,
        `OpenRouter input exceeded ${TEXT_LIMIT} characters; using cleaned source text to preserve full coverage.`,
      ]),
    ];
  }
  return fields;
}
