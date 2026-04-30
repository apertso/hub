import type { ParsedJobFields } from "../types.js";
import { normalizeWhitespace } from "../utils/text.js";

export type ValidationResult = {
  warnings: string[];
  errorCode?: string;
  errorMessage?: string;
};

const SECTION_TITLES = new Set([
  "about",
  "about the job",
  "about us",
  "description",
  "job description",
  "requirements",
  "responsibilities",
  "qualifications",
  "what you will do",
  "what you'll do",
  "the role",
  "overview",
  "job details",
]);

function normalizeTitleForCheck(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^[\s:;,.!?()[\]{}"'`*_/-]+/, "")
    .replace(/[\s:;,.!?()[\]{}"'`*_/-]+$/, "")
    .toLowerCase();
}

export function validateParsedJob(fields: ParsedJobFields): ValidationResult {
  const warnings = [...fields.warnings];
  const description = normalizeWhitespace(fields.jobDescription);

  if (!description) {
    return {
      warnings,
      errorCode: "EMPTY_JOB_DESCRIPTION",
      errorMessage: "Parsed job description is empty.",
    };
  }

  if (description.length < 180) {
    warnings.push("Job description is short; result may be incomplete.");
  }

  if (!normalizeWhitespace(fields.companyName)) {
    warnings.push("Company name was not found.");
  }

  const title = normalizeWhitespace(fields.positionTitle);
  if (!title) {
    warnings.push("Position title was not found.");
  } else if (SECTION_TITLES.has(normalizeTitleForCheck(title))) {
    warnings.push(`Position title looks like a section heading: ${title}.`);
  }

  if (/^(Title|URL Source|Markdown Content):/im.test(fields.jobDescription)) {
    warnings.push("Job description may still contain source metadata.");
  }

  return {
    warnings: [...new Set(warnings)],
  };
}
