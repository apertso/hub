import { extractJobFieldsWithOpenRouter, initializeOpenRouterClient, resetOpenRouterClientForTests } from "./llm/openrouter.js";
import { fetchDirectText } from "./sources/direct.js";
import { fetchGreenhouseJob } from "./sources/greenhouse.js";
import { fetchHhJob } from "./sources/hh.js";
import { fetchLeverJob } from "./sources/lever.js";
import { fetchJinaText } from "./sources/jina.js";
import { fetchLinkedInJob } from "./sources/linkedin.js";
import { fetchTeamtailorJob } from "./sources/teamtailor.js";
import { fetchAshbyJob } from "./sources/ashby.js";
import { fetchTelegramJob } from "./sources/telegram.js";
import {
  JobParserError,
  type JobParseOptions,
  type JobParseResult,
  type JobParseSource,
  type JobParserConfig,
  type ParsedJobFields,
} from "./types.js";
import { normalizeWhitespace } from "./utils/text.js";
import { detectSpecificSource, normalizeJobUrl } from "./utils/url.js";
import { validateParsedJob } from "./validation/validate.js";

type AttemptOrigin = {
  source: JobParseSource;
  browser?: true;
};

type ParseAttempt = AttemptOrigin & {
  run: () => Promise<ParsedJobFields>;
};

type AttemptFailure = AttemptOrigin & {
  code: string;
  message: string;
  httpStatus?: number;
};

type PartialCandidate = AttemptOrigin & {
  fields: ParsedJobFields;
  validationWarnings: string[];
  missingFields: string[];
};

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  return error instanceof JobParserError ? error.code : "PARSE_ATTEMPT_FAILED";
}

function emptyResult(
  rawUrl: string,
  source: JobParseSource,
  errorCodeValue: string,
  errorMessage: string,
  warnings: string[] = [],
): JobParseResult {
  return {
    ok: false,
    url: rawUrl,
    companyName: "",
    positionTitle: "",
    salary: "",
    location: "",
    jobDescription: "",
    source,
    warnings,
    errorCode: errorCodeValue,
    errorMessage,
  };
}

function buildSuccessResult(
  url: string,
  origin: AttemptOrigin,
  fields: ParsedJobFields,
  warnings: string[],
): JobParseResult {
  return {
    ok: true,
    url,
    source: origin.source,
    companyName: fields.companyName,
    positionTitle: fields.positionTitle,
    salary: fields.salary,
    location: fields.location,
    jobDescription: fields.jobDescription,
    warnings: [...new Set(origin.browser ? ["Jina rendered the vacancy in a browser.", ...warnings] : warnings)],
  };
}

function missingCoreFields(fields: ParsedJobFields): string[] {
  const missing: string[] = [];
  if (!normalizeWhitespace(fields.companyName)) {
    missing.push("company name");
  }
  if (!normalizeWhitespace(fields.positionTitle)) {
    missing.push("position title");
  }
  if (!normalizeWhitespace(fields.jobDescription)) {
    missing.push("job description");
  }
  return missing;
}

function incompleteExtractionWarning(candidate: PartialCandidate): string {
  return `${attemptLabel(candidate)} attempt returned an incomplete extraction: missing ${candidate.missingFields.join(", ")}.`;
}

function selectPartialCandidate(candidates: PartialCandidate[]): PartialCandidate | null {
  let selected: PartialCandidate | null = null;
  for (const candidate of candidates) {
    // Validated candidates always carry a description, so fewer missing core fields
    // means more present identity fields. Ties keep the earlier source.
    if (!selected || candidate.missingFields.length < selected.missingFields.length) {
      selected = candidate;
    }
  }
  return selected;
}

function buildAttempts(url: string, signal?: AbortSignal): ParseAttempt[] {
  const attempts: ParseAttempt[] = [];
  const specificSource = detectSpecificSource(url);

  if (specificSource === "linkedin") {
    attempts.push({
      source: "linkedin",
      run: () => fetchLinkedInJob(url, signal),
    });
  }

  if (specificSource === "greenhouse") {
    attempts.push({
      source: "greenhouse",
      run: () => fetchGreenhouseJob(url, signal),
    });
  }

  if (specificSource === "hh") {
    attempts.push({
      source: "hh",
      run: () => fetchHhJob(url, signal),
    });
  }

  if (specificSource === "lever") {
    attempts.push({
      source: "lever",
      run: () => fetchLeverJob(url, signal),
    });
  }

  if (specificSource === "teamtailor") {
    attempts.push({
      source: "teamtailor",
      run: () => fetchTeamtailorJob(url, signal),
    });
  }

  if (specificSource === "ashby") {
    attempts.push({
      source: "ashby",
      run: () => fetchAshbyJob(url, signal),
    });
  }

  if (specificSource === "telegram") {
    attempts.push({
      source: "telegram",
      run: () => fetchTelegramJob(url, signal),
    });
  }

  attempts.push({
    source: "jina",
    run: async () => extractJobFieldsWithOpenRouter(await fetchJinaText(url, signal), signal),
  });

  attempts.push({
    source: "direct",
    run: async () => extractJobFieldsWithOpenRouter(await fetchDirectText(url, signal), signal),
  });

  attempts.push({
    source: "jina",
    browser: true,
    run: async () => extractJobFieldsWithOpenRouter(await fetchJinaText(url, signal, "browser"), signal),
  });

  return attempts;
}

function attemptLabel(origin: AttemptOrigin): string {
  return origin.browser ? "jina browser" : origin.source;
}

function shouldTryBrowser(failures: AttemptFailure[]): boolean {
  const isTargetError = (code: string) => code === "DIRECT_HTTP_ERROR" || code === "JINA_TARGET_HTTP_ERROR";
  if (failures.some(({ code, httpStatus = 0 }) =>
    code.startsWith("OPENROUTER_") ||
    (code === "JINA_HTTP_ERROR" && [401, 402, 403, 429].includes(httpStatus)) ||
    (isTargetError(code) && [401, 404, 410, 429].includes(httpStatus))
  )) {
    return false;
  }
  return failures.some(({ code, httpStatus }) =>
    code === "JINA_TEXT_TOO_SHORT" ||
    code === "DIRECT_TEXT_TOO_SHORT" ||
    code === "DIRECT_SOURCE_BLOCKED" ||
    (isTargetError(code) && httpStatus === 403)
  );
}

function fallbackWarnings(failures: AttemptFailure[]): string[] {
  return failures.map((failure) => `${attemptLabel(failure)} attempt failed: ${failure.message}`);
}

function selectFinalErrorCode(failures: AttemptFailure[]): string {
  const openRouterKeyFailure = failures.find((failure) => failure.code === "OPENROUTER_API_KEY_MISSING");
  if (openRouterKeyFailure) {
    return openRouterKeyFailure.code;
  }

  return failures.at(-1)?.code ?? "PARSE_FAILED";
}

function buildFinalErrorMessage(failures: AttemptFailure[]): string {
  if (failures.length === 0) {
    return "Failed to parse job.";
  }

  return failures.map((failure) => `${attemptLabel(failure)}: ${failure.message}`).join(" | ");
}

export function initializeJobParser(config: JobParserConfig): void {
  initializeOpenRouterClient(config);
}

export function resetJobParserForTests(): void {
  resetOpenRouterClientForTests();
}

export async function parseJob(url: string, { signal }: JobParseOptions = {}): Promise<JobParseResult> {
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeJobUrl(url);
  } catch (error) {
    return emptyResult(
      typeof url === "string" ? url : String(url),
      "direct",
      errorCode(error),
      stringifyError(error),
    );
  }

  const failures: AttemptFailure[] = [];
  const partialCandidates: PartialCandidate[] = [];
  const attempts = buildAttempts(normalizedUrl, signal);

  for (const attempt of attempts) {
    if (signal?.aborted || (attempt.browser && !shouldTryBrowser(failures))) {
      break;
    }
    const { source, browser } = attempt;
    try {
      const fields = await attempt.run();
      const validation = validateParsedJob(fields);
      if (validation.errorCode) {
        throw new JobParserError(validation.errorCode, validation.errorMessage ?? "Parsed job is invalid.");
      }

      const missingFields = missingCoreFields(fields);
      // A Telegram embed is the post itself. Later generic fetches only see the
      // public page shell, so a real message should not be replaced by that shell.
      if (missingFields.length === 0 || source === "telegram") {
        return buildSuccessResult(normalizedUrl, attempt, fields, [
          ...fields.warnings,
          ...validation.warnings,
          ...partialCandidates.map(incompleteExtractionWarning),
          ...fallbackWarnings(failures),
        ]);
      }

      partialCandidates.push({
        source,
        browser,
        fields,
        validationWarnings: validation.warnings,
        missingFields,
      });
    } catch (error) {
      if (signal?.aborted) {
        break;
      }
      failures.push({
        source,
        browser,
        code: errorCode(error),
        message: stringifyError(error),
        httpStatus: error instanceof JobParserError ? error.httpStatus : undefined,
      });
    }
  }

  const warnings = fallbackWarnings(failures);
  const timedOut = signal?.aborted && signal.reason?.name === "TimeoutError";
  const abortMessage = timedOut ? "Job parsing reached its time limit." : "Job parsing was cancelled.";
  if (signal?.aborted) {
    warnings.push(abortMessage);
  }
  const selectedCandidate = selectPartialCandidate(partialCandidates);
  if (selectedCandidate) {
    return buildSuccessResult(normalizedUrl, selectedCandidate, selectedCandidate.fields, [
      ...selectedCandidate.fields.warnings,
      ...selectedCandidate.validationWarnings,
      ...partialCandidates
        .filter((candidate) => candidate !== selectedCandidate)
        .map(incompleteExtractionWarning),
      ...warnings,
    ]);
  }

  return emptyResult(
    normalizedUrl,
    failures.at(-1)?.source ?? "direct",
    signal?.aborted ? (timedOut ? "PARSE_TIMEOUT" : "PARSE_ABORTED") : selectFinalErrorCode(failures),
    signal?.aborted ? abortMessage : buildFinalErrorMessage(failures),
    warnings,
  );
}
