import type { ParsedJobFields } from "../types.js";
import { normalizeWhitespace, sanitizeVacancyText } from "../utils/text.js";

const JOB_DESCRIPTION_LIMIT = 20_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const normalized = normalizeWhitespace(value);
      if (normalized) {
        return normalized;
      }
    }
  }
  return "";
}

function readDescription(record: Record<string, unknown>, rawText: string): { value: string; warning: string | null } {
  for (const key of ["jobDescription", "job_description", "description", "text"]) {
    const value = record[key];
    if (typeof value === "string") {
      const sanitized = sanitizeVacancyText(value).slice(0, JOB_DESCRIPTION_LIMIT);
      if (sanitized) {
        return { value: sanitized, warning: null };
      }
    }
  }

  return {
    value: rawText.slice(0, JOB_DESCRIPTION_LIMIT),
    warning: "Groq did not return jobDescription; using cleaned source text.",
  };
}

function readWarnings(record: Record<string, unknown>): string[] {
  const value = record.warnings;
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

export function normalizeGroqJobFields(payload: unknown, rawText: string): ParsedJobFields {
  const record = asRecord(payload);
  const description = readDescription(record, rawText);
  const warnings = readWarnings(record);
  if (description.warning) {
    warnings.push(description.warning);
  }

  return {
    companyName: readString(record, ["companyName", "company", "company_name", "employer"]),
    positionTitle: readString(record, ["positionTitle", "title", "position_title", "jobTitle", "job_title", "role"]),
    jobDescription: description.value,
    warnings: [...new Set(warnings)],
  };
}
