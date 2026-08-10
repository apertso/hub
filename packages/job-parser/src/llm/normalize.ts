import type { ParsedJobFields } from "../types.js";
import { normalizeWhitespace, sanitizeVacancyText } from "../utils/text.js";

const INCOMPLETE_DESCRIPTION_WARNING = "Groq returned incomplete jobDescription; using cleaned source text.";

type DescriptionResult = {
  value: string;
  warning: string | null;
  fromGroq: boolean;
};

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
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "";
}

function cleanSourceDescription(rawText: string): string {
  const sanitized = sanitizeVacancyText(rawText);
  if (sanitized) {
    return sanitized;
  }

  return rawText.trim();
}

function readDescription(record: Record<string, unknown>, sourceDescription: string): DescriptionResult {
  for (const key of ["jobDescription", "job_description", "description", "text"]) {
    const value = record[key];
    if (typeof value === "string") {
      const sanitized = sanitizeVacancyText(value);
      if (sanitized) {
        return { value: sanitized, warning: null, fromGroq: true };
      }
    }
  }

  return {
    value: sourceDescription,
    warning: "Groq did not return jobDescription; using cleaned source text.",
    fromGroq: false,
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

function normalizeForCoverage(value: string): string {
  return normalizeWhitespace(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .toLowerCase();
}

function isContiguousSubsection(description: string, sourceDescription: string): boolean {
  const normalizedDescription = normalizeForCoverage(description);
  if (normalizedDescription.length < 120) {
    return false;
  }

  return normalizeForCoverage(sourceDescription).includes(normalizedDescription);
}

function isBulletHeavyDescription(description: string): boolean {
  const lines = description
    .split(/\r?\n/g)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  if (lines.length < 3) {
    return false;
  }

  const bulletLines = lines.filter((line) => /^([-*\u2022]|\d+[.)])\s+/.test(line)).length;
  return bulletLines / lines.length >= 0.6;
}

function isGroqDescriptionIncomplete(description: string, sourceDescription: string): boolean {
  const normalizedDescription = normalizeForCoverage(description);
  const normalizedSource = normalizeForCoverage(sourceDescription);
  if (!normalizedDescription || normalizedSource.length < 450) {
    return false;
  }

  const lengthRatio = normalizedDescription.length / normalizedSource.length;
  if (lengthRatio >= 0.8) {
    return false;
  }

  if (lengthRatio < 0.35) {
    return true;
  }

  if (isContiguousSubsection(description, sourceDescription) && lengthRatio < 0.72) {
    return true;
  }

  return isBulletHeavyDescription(description) && lengthRatio < 0.55;
}

export function normalizeGroqJobFields(payload: unknown, rawText: string): ParsedJobFields {
  const record = asRecord(payload);
  const sourceDescription = cleanSourceDescription(rawText);
  const description = readDescription(record, sourceDescription);
  const warnings = readWarnings(record);
  if (description.warning) {
    warnings.push(description.warning);
  }
  if (description.fromGroq && isGroqDescriptionIncomplete(description.value, sourceDescription)) {
    description.value = sourceDescription;
    warnings.push(INCOMPLETE_DESCRIPTION_WARNING);
  }

  return {
    companyName: readString(record, ["companyName", "company", "company_name", "employer"]),
    positionTitle: readString(record, ["positionTitle", "title", "position_title", "jobTitle", "job_title", "role"]),
    salary: readString(record, ["salary", "compensation", "pay", "baseSalary", "base_salary", "salaryRange", "salary_range"]),
    location: readString(record, ["location", "jobLocation", "job_location", "workLocation", "work_location"]),
    jobDescription: description.value,
    warnings: [...new Set(warnings)],
  };
}
