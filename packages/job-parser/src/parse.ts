import { extractJobFieldsWithGroq, initializeGroqClient, resetGroqClientForTests } from "./llm/groq.js";
import { fetchDirectText } from "./sources/direct.js";
import { fetchGreenhouseJob } from "./sources/greenhouse.js";
import { fetchHhJob } from "./sources/hh.js";
import { fetchLeverJob } from "./sources/lever.js";
import { fetchJinaText } from "./sources/jina.js";
import { fetchLinkedInJob } from "./sources/linkedin.js";
import { fetchTeamtailorJob } from "./sources/teamtailor.js";
import {
  JobParserError,
  type JobDescriptionEvidenceSource,
  type JobParseDiagnostics,
  type JobParseResult,
  type JobParseSource,
  type JobParserConfig,
  type ParsedJobFields,
} from "./types.js";
import { detectSpecificSource, normalizeJobUrl } from "./utils/url.js";
import { validateParsedJob } from "./validation/validate.js";
import { verifyGenericJobDescription } from "./verification/generic.js";

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
  diagnostics?: JobParseDiagnostics,
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
    diagnostics,
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

function parseSourceForEvidence(source: JobDescriptionEvidenceSource): JobParseSource {
  return source === "jsonld" ? "direct" : source;
}

function sourceForFailedVerification(diagnostics: JobParseDiagnostics): JobParseSource {
  const successfulSource = diagnostics.sources.find((source) => source.ok)?.source;
  return successfulSource ? parseSourceForEvidence(successfulSource) : "direct";
}

async function parseVerifiedGenericJob(url: string): Promise<JobParseResult> {
  const verification = await verifyGenericJobDescription(url);
  if (!verification.ok) {
    return emptyResult(
      url,
      sourceForFailedVerification(verification.diagnostics),
      verification.errorCode,
      verification.errorMessage,
      [],
      verification.diagnostics,
    );
  }

  const source = parseSourceForEvidence(verification.source);
  try {
    const fields = await extractJobFieldsWithGroq(verification.text);
    const validation = validateParsedJob(fields);
    if (validation.errorCode) {
      throw new JobParserError(validation.errorCode, validation.errorMessage ?? "Parsed job is invalid.");
    }

    return {
      ok: true,
      url,
      source,
      companyName: fields.companyName,
      positionTitle: fields.positionTitle,
      salary: fields.salary,
      location: fields.location,
      jobDescription: fields.jobDescription,
      warnings: [...new Set([...fields.warnings, ...validation.warnings])],
      diagnostics: verification.diagnostics,
    };
  } catch (error) {
    const message = stringifyError(error);
    return emptyResult(
      url,
      source,
      errorCode(error),
      message,
      [`${source} attempt failed: ${message}`],
      verification.diagnostics,
    );
  }
}

export function initializeJobParser(config: JobParserConfig): void {
  initializeGroqClient(config);
}

export function resetJobParserForTests(): void {
  resetGroqClientForTests();
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

  if (!detectSpecificSource(normalizedUrl)) {
    return parseVerifiedGenericJob(normalizedUrl);
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
        salary: fields.salary,
        location: fields.location,
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
