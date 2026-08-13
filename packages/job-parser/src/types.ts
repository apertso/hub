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

export type JobParseResult = ParsedJobFields & {
  ok: boolean;
  url: string;
  source: JobParseSource;
  errorCode?: string;
  errorMessage?: string;
};

export type JobParserConfig = {
  openRouterApiKey: string;
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
