import { JobParserError } from "../types.js";
import {
  isVacancyTextTooShort,
  sanitizeVacancyText,
  stripJinaEnvelope,
} from "../utils/text.js";

const FETCH_TIMEOUT_MS = 15_000;

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

export async function fetchJinaText(url: string): Promise<string> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Accept: "text/plain",
    },
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new JobParserError("JINA_HTTP_ERROR", `Jina returned HTTP ${response.status}.`);
  }

  const text = sanitizeVacancyText(stripJinaEnvelope(await response.text()));
  if (isVacancyTextTooShort(text)) {
    throw new JobParserError("JINA_TEXT_TOO_SHORT", "Jina result is missing useful vacancy text.");
  }

  return text;
}
