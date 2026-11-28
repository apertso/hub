import type { ApplicationQuestion } from "../types.js";
import { normalizeWhitespace } from "./text.js";

const MAX_QUESTIONS = 60;
const MAX_OPTIONS = 40;
const MAX_TEXT_LENGTH = 300;

export type RawApplicationQuestion = {
  label: unknown;
  required: unknown;
  options: unknown[];
};

function readText(value: unknown): string {
  return typeof value === "string" ? normalizeWhitespace(value).slice(0, MAX_TEXT_LENGTH) : "";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Normalizes ATS form questions, dropping unlabeled ones and capping list sizes. */
export function buildApplicationQuestions(items: RawApplicationQuestion[]): ApplicationQuestion[] {
  const questions: ApplicationQuestion[] = [];
  for (const item of items) {
    const label = readText(item.label);
    if (!label) {
      continue;
    }
    const options = [...new Set(item.options.map(readText).filter(Boolean))].slice(0, MAX_OPTIONS);
    questions.push({ label, required: item.required === true, options });
    if (questions.length >= MAX_QUESTIONS) {
      break;
    }
  }
  return questions;
}
