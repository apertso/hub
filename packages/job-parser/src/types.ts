export type JobParseSource = "linkedin" | "greenhouse" | "hh" | "jina" | "direct";

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
