export type JobParseSource = "linkedin" | "greenhouse" | "jina" | "direct";

export type ParsedJobFields = {
  companyName: string;
  positionTitle: string;
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

export class JobParserError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "JobParserError";
    this.code = code;
  }
}
