import { JobParserError, type ParsedJobFields } from "../types.js";
import { normalizeGroqJobFields } from "./normalize.js";

const DEFAULT_MODEL = "llama-3.1-8b-instant";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_BACKOFF_MS = [1_000, 2_500, 5_000];
const TEXT_LIMIT = 20_000;

export type GroqClient = {
  apiKey: string;
  model: string;
};

type GroqJsonRequest = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
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

  return stringifyError(error).toLowerCase().includes("429");
}

function createHttpError(status: number, body: string): Error {
  const error = new Error(`Groq HTTP ${status}: ${body.slice(0, 2000)}`);
  (error as { status?: number }).status = status;
  return error;
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
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }

  return "";
}

function stripCodeFences(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fencedMatch?.[1]?.trim() || text.trim();
}

function extractJsonObject(text: string): string {
  const trimmed = stripCodeFences(text);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new JobParserError("GROQ_INVALID_JSON", "Groq response does not contain a JSON object.");
  }
  return trimmed.slice(start, end + 1);
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

export function createGroqClientFromEnv(environment: NodeJS.ProcessEnv = process.env): GroqClient {
  const apiKey = environment.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new JobParserError("GROQ_API_KEY_MISSING", "GROQ_API_KEY is not configured.");
  }

  return {
    apiKey,
    model: environment.JOB_PARSER_LLM_MODEL?.trim() || DEFAULT_MODEL,
  };
}

async function requestGroqJsonObject<T extends Record<string, unknown>>(
  client: GroqClient,
  request: GroqJsonRequest,
): Promise<T> {
  for (let attempt = 0; attempt <= DEFAULT_BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: timeoutSignal(request.timeoutMs ?? 60_000),
        body: JSON.stringify({
          model: client.model,
          temperature: request.temperature ?? 0,
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: request.systemPrompt,
            },
            {
              role: "user",
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
        throw new JobParserError("GROQ_RESPONSE_NOT_JSON", `Groq returned non-JSON response: ${body.slice(0, 2000)}`);
      }

      const content = extractMessageText(payload);
      if (!content) {
        throw new JobParserError("GROQ_EMPTY_RESPONSE", "Groq response did not include message content.");
      }

      try {
        return JSON.parse(extractJsonObject(content)) as T;
      } catch (error) {
        if (error instanceof JobParserError) {
          throw error;
        }
        throw new JobParserError("GROQ_INVALID_JSON", `Groq returned invalid JSON content: ${content.slice(0, 2000)}`);
      }
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= DEFAULT_BACKOFF_MS.length) {
        if (error instanceof JobParserError) {
          throw error;
        }
        throw new JobParserError("GROQ_REQUEST_FAILED", stringifyError(error));
      }
      await sleep(DEFAULT_BACKOFF_MS[attempt]);
    }
  }

  throw new JobParserError("GROQ_REQUEST_FAILED", "Groq request failed after retries.");
}

export async function extractJobFieldsWithGroq(rawText: string): Promise<ParsedJobFields> {
  const client = createGroqClientFromEnv();
  const truncatedText = rawText.slice(0, TEXT_LIMIT);
  const payload = await requestGroqJsonObject<Record<string, unknown>>(client, {
    temperature: 0,
    maxTokens: 4_000,
    systemPrompt:
      "You extract job posting fields. Return only one valid JSON object with no markdown or explanations.",
    userPrompt: [
      "Extract the job posting fields from the text below.",
      "Return JSON with exactly these keys:",
      "- companyName: string",
      "- positionTitle: string",
      "- jobDescription: string containing the cleaned vacancy text, not a summary",
      "- warnings: string[] for uncertainty, missing data, or suspicious extraction",
      "",
      "Do not invent company or role names. If a field is absent, return an empty string and explain it in warnings.",
      "",
      "Text:",
      truncatedText,
    ].join("\n"),
  });

  return normalizeGroqJobFields(payload, truncatedText);
}
