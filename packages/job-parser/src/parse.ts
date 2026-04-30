import { extractJobFieldsWithGroq } from "./llm/groq.js";
import { fetchDirectText } from "./sources/direct.js";
import { fetchGreenhouseJob } from "./sources/greenhouse.js";
import { fetchJinaText } from "./sources/jina.js";
import { fetchLinkedInJob } from "./sources/linkedin.js";
import { JobParserError, type JobParseResult, type JobParseSource, type ParsedJobFields } from "./types.js";
import { detectSpecificSource, normalizeJobUrl } from "./utils/url.js";
import { validateParsedJob } from "./validation/validate.js";

type ParseAttempt = {
  source: JobParseSource;
  run: () => Promise<ParsedJobFields>;
};

type AttemptFailure = {
  source: JobParseSource;
  code: string;
  message: string;
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
    jobDescription: "",
    source,
    warnings,
    errorCode: errorCodeValue,
    errorMessage,
  };
}

function buildAttempts(url: string): ParseAttempt[] {
  const attempts: ParseAttempt[] = [];
  const specificSource = detectSpecificSource(url);

  if (specificSource === "linkedin") {
    attempts.push({
      source: "linkedin",
      run: () => fetchLinkedInJob(url),
    });
  }

  if (specificSource === "greenhouse") {
    attempts.push({
      source: "greenhouse",
      run: () => fetchGreenhouseJob(url),
    });
  }

  attempts.push({
    source: "jina",
    run: async () => extractJobFieldsWithGroq(await fetchJinaText(url)),
  });

  attempts.push({
    source: "direct",
    run: async () => extractJobFieldsWithGroq(await fetchDirectText(url)),
  });

  return attempts;
}

function fallbackWarnings(failures: AttemptFailure[]): string[] {
  return failures.map((failure) => `${failure.source} attempt failed: ${failure.message}`);
}

function selectFinalErrorCode(failures: AttemptFailure[]): string {
  const groqKeyFailure = failures.find((failure) => failure.code === "GROQ_API_KEY_MISSING");
  if (groqKeyFailure) {
    return groqKeyFailure.code;
  }

  return failures.at(-1)?.code ?? "PARSE_FAILED";
}

function buildFinalErrorMessage(failures: AttemptFailure[]): string {
  if (failures.length === 0) {
    return "Failed to parse job.";
  }

  return failures.map((failure) => `${failure.source}: ${failure.message}`).join(" | ");
}

export async function parseJob(url: string): Promise<JobParseResult> {
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
  const attempts = buildAttempts(normalizedUrl);

  for (const attempt of attempts) {
    try {
      const fields = await attempt.run();
      const validation = validateParsedJob(fields);
      if (validation.errorCode) {
        throw new JobParserError(validation.errorCode, validation.errorMessage ?? "Parsed job is invalid.");
      }

      return {
        ok: true,
        url: normalizedUrl,
        source: attempt.source,
        companyName: fields.companyName,
        positionTitle: fields.positionTitle,
        jobDescription: fields.jobDescription,
        warnings: [...new Set([...fields.warnings, ...validation.warnings, ...fallbackWarnings(failures)])],
      };
    } catch (error) {
      failures.push({
        source: attempt.source,
        code: errorCode(error),
        message: stringifyError(error),
      });
    }
  }

  return emptyResult(
    normalizedUrl,
    failures.at(-1)?.source ?? "direct",
    selectFinalErrorCode(failures),
    buildFinalErrorMessage(failures),
    fallbackWarnings(failures),
  );
}
