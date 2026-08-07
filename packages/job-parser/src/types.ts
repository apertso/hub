export const JOB_PARSE_SOURCES = [
  "linkedin",
  "greenhouse",
  "hh",
  "lever",
  "teamtailor",
  "jina",
  "direct",
] as const;

export type JobParseSource = (typeof JOB_PARSE_SOURCES)[number];

export function isJobParseSource(value: unknown): value is JobParseSource {
  return typeof value === "string" && (JOB_PARSE_SOURCES as readonly string[]).includes(value);
}

export type ParsedJobFields = {
  companyName: string;
  positionTitle: string;
  salary: string;
  location: string;
  jobDescription: string;
  warnings: string[];
};

export type JobDescriptionEvidenceSource = "jina" | "direct" | "jsonld";

export type JobDescriptionSourceDiagnostic = {
  source: JobDescriptionEvidenceSource;
  ok: boolean;
  textLength: number;
  errorCode?: string;
  errorMessage?: string;
};

export type JobDescriptionComparisonDiagnostic = {
  leftSource: JobDescriptionEvidenceSource;
  rightSource: JobDescriptionEvidenceSource;
  lengthRatio: number;
  coverageRatio: number;
  similarityRatio: number;
  sectionCoverageRatio: number;
  missingSections: string[];
  agrees: boolean;
};

export type JobParseDiagnostics = {
  verificationStatus: "verified" | "incomplete" | "unverified";
  selectedSource?: JobDescriptionEvidenceSource;
  sources: JobDescriptionSourceDiagnostic[];
  comparisons: JobDescriptionComparisonDiagnostic[];
};

export type JobParseResult = ParsedJobFields & {
  ok: boolean;
  url: string;
  source: JobParseSource;
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: JobParseDiagnostics;
};

export type JobParserConfig = {
  groqApiKey: string;
  llmModel?: string;
};

export class JobParserError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "JobParserError";
    this.code = code;
  }
}
