import { JobParserError } from "../types.js";
import { requestSignal } from "../utils/abort.js";
import {
  isVacancyTextTooShort,
  sanitizeVacancyText,
  stripJinaEnvelope,
} from "../utils/text.js";

const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_FETCH_TIMEOUT_MS = 25_000;

export async function fetchJinaText(
  url: string,
  signal?: AbortSignal,
  mode: "auto" | "browser" = "auto",
): Promise<string> {
  const headers: Record<string, string> = { Accept: "text/plain" };
  if (mode === "browser") {
    headers["X-Engine"] = "browser";
    headers["X-No-Cache"] = "true";
    headers["X-Timeout"] = "16";
    headers["X-Respond-With"] = "markdown";
  }
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    signal: requestSignal(mode === "browser" ? BROWSER_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS, signal),
  });

  if (!response.ok) {
    throw new JobParserError("JINA_HTTP_ERROR", `Jina returned HTTP ${response.status}.`, response.status);
  }

  const rawText = await response.text();
  // Reader may return HTTP 200 for an upstream error. Inspect its metadata
  // before removing the envelope or sending the content to the model.
  const envelope = rawText.split(/^Markdown Content:\s*$/im, 1)[0];
  const targetError = envelope.match(/^Warning:\s*Target URL returned error (\d{3})\b/im);
  if (targetError) {
    const status = Number(targetError[1]);
    throw new JobParserError("JINA_TARGET_HTTP_ERROR", `Jina target returned HTTP ${status}.`, status);
  }
  const text = sanitizeVacancyText(stripJinaEnvelope(rawText));
  if (isVacancyTextTooShort(text)) {
    throw new JobParserError("JINA_TEXT_TOO_SHORT", "Jina result is missing useful vacancy text.");
  }

  return text;
}
