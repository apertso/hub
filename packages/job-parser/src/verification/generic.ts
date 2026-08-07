import { fetchDirectJobEvidence } from "../sources/direct.js";
import { fetchJinaJobEvidence } from "../sources/jina.js";
import { sectionKeysFor } from "../llm/normalize.js";
import {
  JobParserError,
  type JobDescriptionComparisonDiagnostic,
  type JobDescriptionEvidenceSource,
  type JobDescriptionSourceDiagnostic,
  type JobParseDiagnostics,
} from "../types.js";
import {
  isVacancyTextTooShort,
  MAX_VACANCY_TEXT_LENGTH,
  normalizeWhitespace,
} from "../utils/text.js";

const MIN_AGREEMENT_COVERAGE = 0.8;
const MIN_AGREEMENT_LENGTH_RATIO = 0.75;

type Evidence = {
  source: JobDescriptionEvidenceSource;
  text: string;
};

export type GenericVerificationResult =
  | {
      ok: true;
      text: string;
      source: JobDescriptionEvidenceSource;
      diagnostics: JobParseDiagnostics;
    }
  | {
      ok: false;
      errorCode: "JOB_DESCRIPTION_INCOMPLETE" | "JOB_DESCRIPTION_UNVERIFIED";
      errorMessage: string;
      diagnostics: JobParseDiagnostics;
    };

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof JobParserError ? error.code : fallback;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function normalizedTokens(value: string): string[] {
  return normalizeWhitespace(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function shingles(tokens: string[]): Set<string> {
  if (tokens.length < 3) {
    return new Set(tokens);
  }

  const result = new Set<string>();
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    result.add(tokens.slice(index, index + 3).join(" "));
  }
  return result;
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }
  return count;
}

function compareEvidence(left: Evidence, right: Evidence): JobDescriptionComparisonDiagnostic {
  const leftTokens = normalizedTokens(left.text);
  const rightTokens = normalizedTokens(right.text);
  const leftShingles = shingles(leftTokens);
  const rightShingles = shingles(rightTokens);
  const sharedShingles = intersectionSize(leftShingles, rightShingles);
  const leftCoverage = leftShingles.size === 0 ? 0 : sharedShingles / leftShingles.size;
  const rightCoverage = rightShingles.size === 0 ? 0 : sharedShingles / rightShingles.size;
  const coverageRatio = Math.min(leftCoverage, rightCoverage);
  const unionSize = leftShingles.size + rightShingles.size - sharedShingles;
  const similarityRatio = unionSize === 0 ? 0 : sharedShingles / unionSize;
  const leftLength = normalizeWhitespace(left.text).length;
  const rightLength = normalizeWhitespace(right.text).length;
  const lengthRatio = Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength);
  const longerText = leftLength >= rightLength ? left.text : right.text;
  const shorterText = leftLength >= rightLength ? right.text : left.text;
  const longerSections = sectionKeysFor(longerText);
  const shorterSections = sectionKeysFor(shorterText);
  const sharedSections = intersectionSize(longerSections, shorterSections);
  const sectionCoverageRatio = longerSections.size === 0 ? 1 : sharedSections / longerSections.size;
  const missingSections = [...longerSections].filter((section) => !shorterSections.has(section));
  const hasMaterialSectionGap = missingSections.length > 0 && lengthRatio < 0.95;

  return {
    leftSource: left.source,
    rightSource: right.source,
    lengthRatio: roundRatio(lengthRatio),
    coverageRatio: roundRatio(coverageRatio),
    similarityRatio: roundRatio(similarityRatio),
    sectionCoverageRatio: roundRatio(sectionCoverageRatio),
    missingSections,
    agrees:
      coverageRatio >= MIN_AGREEMENT_COVERAGE &&
      lengthRatio >= MIN_AGREEMENT_LENGTH_RATIO &&
      !hasMaterialSectionGap,
  };
}

function successfulDiagnostic(source: JobDescriptionEvidenceSource, text: string): JobDescriptionSourceDiagnostic {
  return {
    source,
    ok: true,
    textLength: normalizeWhitespace(text).length,
  };
}

function failedDiagnostic(
  source: JobDescriptionEvidenceSource,
  textLength: number,
  code: string,
  message: string,
): JobDescriptionSourceDiagnostic {
  return {
    source,
    ok: false,
    textLength,
    errorCode: code,
    errorMessage: message,
  };
}

function diagnosticForText(
  source: JobDescriptionEvidenceSource,
  text: string,
  code: string,
  message: string,
): JobDescriptionSourceDiagnostic {
  const textLength = normalizeWhitespace(text).length;
  if (text.length >= MAX_VACANCY_TEXT_LENGTH) {
    return failedDiagnostic(
      source,
      textLength,
      "SOURCE_TEXT_LIMIT_EXCEEDED",
      `Source text reached the ${MAX_VACANCY_TEXT_LENGTH}-character safety limit; completeness cannot be verified.`,
    );
  }
  return isVacancyTextTooShort(text)
    ? failedDiagnostic(source, textLength, code, message)
    : successfulDiagnostic(source, text);
}

function buildComparisons(evidence: Evidence[]): JobDescriptionComparisonDiagnostic[] {
  const comparisons: JobDescriptionComparisonDiagnostic[] = [];
  for (let leftIndex = 0; leftIndex < evidence.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < evidence.length; rightIndex += 1) {
      const left = evidence[leftIndex];
      const right = evidence[rightIndex];
      if (left && right) {
        comparisons.push(compareEvidence(left, right));
      }
    }
  }
  return comparisons;
}

function evidenceForSource(evidence: Evidence[], source: JobDescriptionEvidenceSource): Evidence {
  const match = evidence.find((item) => item.source === source);
  if (!match) {
    throw new Error(`Missing evidence for verified source: ${source}.`);
  }
  return match;
}

function selectVerifiedEvidence(
  evidence: Evidence[],
  comparisons: JobDescriptionComparisonDiagnostic[],
): Evidence | null {
  const agreement = comparisons
    .filter((comparison) => comparison.agrees)
    .sort((left, right) => {
      const ratioDifference = right.coverageRatio - left.coverageRatio;
      if (ratioDifference !== 0) {
        return ratioDifference;
      }
      const leftLength = Math.max(
        evidenceForSource(evidence, left.leftSource).text.length,
        evidenceForSource(evidence, left.rightSource).text.length,
      );
      const rightLength = Math.max(
        evidenceForSource(evidence, right.leftSource).text.length,
        evidenceForSource(evidence, right.rightSource).text.length,
      );
      return rightLength - leftLength;
    })[0];

  if (!agreement) {
    return null;
  }

  const left = evidenceForSource(evidence, agreement.leftSource);
  const right = evidenceForSource(evidence, agreement.rightSource);
  return normalizeWhitespace(left.text).length >= normalizeWhitespace(right.text).length ? left : right;
}

export async function verifyGenericJobDescription(url: string): Promise<GenericVerificationResult> {
  const [jinaResult, directResult] = await Promise.allSettled([
    fetchJinaJobEvidence(url),
    fetchDirectJobEvidence(url),
  ]);
  const evidence: Evidence[] = [];
  const sources: JobDescriptionSourceDiagnostic[] = [];

  if (jinaResult.status === "fulfilled") {
    const diagnostic = diagnosticForText(
      "jina",
      jinaResult.value,
      "JINA_TEXT_TOO_SHORT",
      "Jina result is missing useful vacancy text.",
    );
    sources.push(diagnostic);
    if (diagnostic.ok) {
      evidence.push({ source: "jina", text: jinaResult.value });
    }
  } else {
    sources.push(failedDiagnostic(
      "jina",
      0,
      errorCode(jinaResult.reason, "JINA_FETCH_FAILED"),
      stringifyError(jinaResult.reason),
    ));
  }

  if (directResult.status === "fulfilled") {
    const directDiagnostic = diagnosticForText(
      "direct",
      directResult.value.directText,
      "DIRECT_TEXT_TOO_SHORT",
      "Direct fetch result is missing useful visible vacancy text.",
    );
    const structuredDiagnostic = diagnosticForText(
      "jsonld",
      directResult.value.structuredText,
      "JSON_LD_DESCRIPTION_MISSING",
      "JobPosting.description JSON-LD is missing or too short.",
    );
    sources.push(directDiagnostic, structuredDiagnostic);
    if (directDiagnostic.ok) {
      evidence.push({ source: "direct", text: directResult.value.directText });
    }
    if (structuredDiagnostic.ok) {
      evidence.push({ source: "jsonld", text: directResult.value.structuredText });
    }
  } else {
    const directErrorCode = errorCode(directResult.reason, "DIRECT_FETCH_FAILED");
    const directErrorMessage = stringifyError(directResult.reason);
    sources.push(
      failedDiagnostic("direct", 0, directErrorCode, directErrorMessage),
      failedDiagnostic("jsonld", 0, "JSON_LD_UNAVAILABLE", `Direct fetch failed: ${directErrorMessage}`),
    );
  }

  const comparisons = buildComparisons(evidence);
  const selected = selectVerifiedEvidence(evidence, comparisons);
  if (selected) {
    return {
      ok: true,
      text: selected.text,
      source: selected.source,
      diagnostics: {
        verificationStatus: "verified",
        selectedSource: selected.source,
        sources,
        comparisons,
      },
    };
  }

  if (evidence.length < 2) {
    return {
      ok: false,
      errorCode: "JOB_DESCRIPTION_UNVERIFIED",
      errorMessage: evidence.length === 1
        ? "Only one independent description source succeeded; completeness could not be established."
        : "No independent description source produced enough text to verify completeness.",
      diagnostics: {
        verificationStatus: "unverified",
        sources,
        comparisons,
      },
    };
  }

  return {
    ok: false,
    errorCode: "JOB_DESCRIPTION_INCOMPLETE",
    errorMessage: "Generic description sources diverged; completeness could not be established.",
    diagnostics: {
      verificationStatus: "incomplete",
      sources,
      comparisons,
    },
  };
}
