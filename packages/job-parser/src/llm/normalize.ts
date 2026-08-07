import type { ParsedJobFields } from "../types.js";
import { normalizeWhitespace, sanitizeVacancyText } from "../utils/text.js";

const INCOMPLETE_DESCRIPTION_WARNING = "Groq returned incomplete jobDescription; using cleaned source text.";
const CORE_SECTION_KEYS = new Set(["intro", "responsibilities", "requirements", "benefits"]);

type DescriptionResult = {
  value: string;
  warning: string | null;
  fromGroq: boolean;
};

const VACANCY_SECTION_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  {
    key: "intro",
    pattern:
      /^(\s*[-*]\s*)?(about (the )?(job|role)|about us|who we are|overview|summary|the role|role overview|job description)\b/im,
  },
  {
    key: "responsibilities",
    pattern:
      /^(\s*[-*]\s*)?((key|core|main)\s+)?(responsibilities|duties|what you(?:'|\u2019)ll do|what you will do|your impact|impact you(?:'|\u2019)ll have)\b/im,
  },
  {
    key: "requirements",
    pattern:
      /^(\s*[-*]\s*)?((required|preferred)\s+)?(requirements?|required experience|experience|qualifications?|skills|about you|what we(?:'|\u2019)re looking for|we(?:'|\u2019)d love to hear)\b/im,
  },
  {
    key: "benefits",
    pattern: /^(\s*[-*]\s*)?(benefits|perks|what we offer|why join|our offer)\b/im,
  },
  {
    key: "compensation",
    pattern: /^(\s*[-*]\s*)?(compensation|salary|pay range|base pay)\b/im,
  },
  {
    key: "location",
    pattern: /^(\s*[-*]\s*)?(location|work format|remote|hybrid|on-?site|onsite)\b/im,
  },
];

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

export function sectionKeysFor(value: string): Set<string> {
  const keys = new Set<string>();
  for (const section of VACANCY_SECTION_PATTERNS) {
    if (section.pattern.test(value)) {
      keys.add(section.key);
    }
  }
  return keys;
}

function isContiguousSubsection(description: string, sourceDescription: string): boolean {
  const normalizedDescription = normalizeForCoverage(description);
  if (normalizedDescription.length < 120) {
    return false;
  }

  return normalizeForCoverage(sourceDescription).includes(normalizedDescription);
}

function firstMeaningfulLine(value: string): string {
  return value
    .split(/\r?\n/g)
    .map((line) => normalizeWhitespace(line))
    .find(Boolean) ?? "";
}

function startsWithNonIntroSection(description: string): boolean {
  const firstLine = firstMeaningfulLine(description);
  return VACANCY_SECTION_PATTERNS
    .filter((section) => section.key !== "intro")
    .some((section) => section.pattern.test(firstLine));
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

  const sourceSections = sectionKeysFor(sourceDescription);
  if (sourceSections.size < 2) {
    return false;
  }

  const descriptionSections = sectionKeysFor(description);
  const missingSections = [...sourceSections].filter((key) => !descriptionSections.has(key));
  const missingCoreSections = missingSections.filter((key) => CORE_SECTION_KEYS.has(key));
  const sourceCoreSections = [...sourceSections].filter((key) => CORE_SECTION_KEYS.has(key));
  const singleSectionOutput =
    descriptionSections.size <= 1 && (startsWithNonIntroSection(description) || isBulletHeavyDescription(description));

  if (sourceCoreSections.length >= 3 && missingCoreSections.length >= 2 && lengthRatio < 0.65) {
    return true;
  }

  if (missingCoreSections.length >= 1 && lengthRatio < 0.35) {
    return true;
  }

  if (isContiguousSubsection(description, sourceDescription) && missingCoreSections.length >= 1 && lengthRatio < 0.55) {
    return true;
  }

  return sourceSections.has("intro") && !descriptionSections.has("intro") && singleSectionOutput && lengthRatio < 0.72;
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
