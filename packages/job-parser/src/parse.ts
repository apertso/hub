import { extractJobFieldsWithOpenRouter, initializeOpenRouterClient, resetOpenRouterClientForTests } from "./llm/openrouter.js";
import { fetchDirectText } from "./sources/direct.js";
import { fetchGreenhouseJob } from "./sources/greenhouse.js";
import { fetchHhJob } from "./sources/hh.js";
import { fetchLeverJob } from "./sources/lever.js";
import { fetchJinaText } from "./sources/jina.js";
import { fetchLinkedInJob } from "./sources/linkedin.js";
import { fetchTeamtailorJob } from "./sources/teamtailor.js";
import {
  JobParserError,
  type JobParseResult,
  type JobParseSource,
  type JobParserConfig,
  type ParsedJobFields,
} from "./types.js";
import { normalizeWhitespace } from "./utils/text.js";
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

type PartialCandidate = {
  source: JobParseSource;
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
  source: JobParseSource,
  fields: ParsedJobFields,
  warnings: string[],
): JobParseResult {
  return {
    ok: true,
    url,
    source,
    companyName: fields.companyName,
    positionTitle: fields.positionTitle,
    salary: fields.salary,
    location: fields.location,
    jobDescription: fields.jobDescription,
    warnings: [...new Set(warnings)],
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
  return `${candidate.source} attempt returned an incomplete extraction: missing ${candidate.missingFields.join(", ")}.`;
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

  if (specificSource === "hh") {
    attempts.push({
      source: "hh",
      run: () => fetchHhJob(url),
    });
  }

  if (specificSource === "lever") {
    attempts.push({
      source: "lever",
      run: () => fetchLeverJob(url),
    });
  }

  if (specificSource === "teamtailor") {
    attempts.push({
      source: "teamtailor",
      run: () => fetchTeamtailorJob(url),
    });
  }

  attempts.push({
    source: "jina",
    run: async () => extractJobFieldsWithOpenRouter(await fetchJinaText(url)),
  });

  attempts.push({
    source: "direct",
    run: async () => extractJobFieldsWithOpenRouter(await fetchDirectText(url)),
  });

  return attempts;
}

function fallbackWarnings(failures: AttemptFailure[]): string[] {
  return failures.map((failure) => `${failure.source} attempt failed: ${failure.message}`);
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

  return failures.map((failure) => `${failure.source}: ${failure.message}`).join(" | ");
}

export function initializeJobParser(config: JobParserConfig): void {
  initializeOpenRouterClient(config);
}

export function resetJobParserForTests(): void {
  resetOpenRouterClientForTests();
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
  const partialCandidates: PartialCandidate[] = [];
  const attempts = buildAttempts(normalizedUrl);

  for (const attempt of attempts) {
    try {
      const fields = await attempt.run();
      const validation = validateParsedJob(fields);
      if (validation.errorCode) {
        throw new JobParserError(validation.errorCode, validation.errorMessage ?? "Parsed job is invalid.");
      }

      const missingFields = missingCoreFields(fields);
      if (missingFields.length === 0) {
        return buildSuccessResult(normalizedUrl, attempt.source, fields, [
          ...fields.warnings,
          ...validation.warnings,
          ...partialCandidates.map(incompleteExtractionWarning),
          ...fallbackWarnings(failures),
        ]);
      }

      partialCandidates.push({
        source: attempt.source,
        fields,
        validationWarnings: validation.warnings,
        missingFields,
      });
    } catch (error) {
      failures.push({
        source: attempt.source,
        code: errorCode(error),
        message: stringifyError(error),
      });
    }
  }

  const selectedCandidate = selectPartialCandidate(partialCandidates);
  if (selectedCandidate) {
    return buildSuccessResult(normalizedUrl, selectedCandidate.source, selectedCandidate.fields, [
      ...selectedCandidate.fields.warnings,
      ...selectedCandidate.validationWarnings,
      ...partialCandidates
        .filter((candidate) => candidate !== selectedCandidate)
        .map(incompleteExtractionWarning),
      ...fallbackWarnings(failures),
    ]);
  }

  return emptyResult(
    normalizedUrl,
    failures.at(-1)?.source ?? "direct",
    selectFinalErrorCode(failures),
    buildFinalErrorMessage(failures),
    fallbackWarnings(failures),
  );
}
