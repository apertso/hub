import * as cheerio from "cheerio";

export const MAX_VACANCY_TEXT_LENGTH = 100_000;
const MIN_EFFECTIVE_VACANCY_TEXT_LENGTH = 180;

const NOISE_PATTERNS: RegExp[] = [
  /\blinkedin respects your privacy\b/i,
  /\bcookie policy\b/i,
  /\baccept\b.*\breject\b/i,
  /^accept$/i,
  /^reject$/i,
  /\baccept all\b/i,
  /\breject all\b/i,
  /\bsee who .* has hired for this role\b/i,
  /\breport this job\b/i,
  /\bset alert\b/i,
  /\bsign in\b/i,
  /\bjoin now\b/i,
  /\bjoin linkedin\b/i,
  /\|\s*linkedin\b/i,
  /\bskip to main content\b/i,
  /\bexpand search\b/i,
  /\bclear text\b/i,
  /\bget notified about new\b/i,
  /\buse ai to assess how you fit\b/i,
  /\btailor my resume\b/i,
  /\bam i a good fit for this job\b/i,
  /\bsimilar jobs\b/i,
  /\bsimilar searches\b/i,
  /\bpeople also viewed\b/i,
  /\b\d+\s+applicants\b/i,
  /\b\d+\s+(day|days|hour|hours|week|weeks|month|months)\s+ago\b/i,
  /\bshow more jobs like this\b/i,
  /\bshow fewer jobs like this\b/i,
  /\bexplore top content on linkedin\b/i,
  /\bfind curated posts and insights\b/i,
  /\bagree & join linkedin\b/i,
  /\bmore searches\b/i,
  /\blinkedin\s+©\b/i,
  /&copy;\s*\d{4}/i,
  /\bcopyright policy\b/i,
  /\bbrand policy\b/i,
  /\bprivacy policy\b/i,
  /\bguest controls\b/i,
  /\bcommunity guidelines\b/i,
  /\bopen jobs\b/i,
  /\bby clicking continue to join or sign in\b/i,
  /\breferrals increase your chances of interviewing\b/i,
  /\bsee who you know\b/i,
  /\bshow more\b/i,
  /\bshow less\b/i,
];

const START_CUES = [
  "about the job",
  "what do we do",
  "who we are",
  "about us",
  "our mission",
  "the role",
  "what you'll do",
  "as a",
  "what you can expect",
  "responsibilities",
  "requirements",
  "we'd love to hear",
  "impact you'll have",
  "about you",
  "hiring process",
  "job description",
  "qualifications",
];

const STOP_CUES = [
  "similar jobs",
  "people also viewed",
  "similar searches",
  "find curated posts",
  "agree & join linkedin",
  "referrals increase your chances",
  "see who you know",
  "show less",
  "copyright",
  "brand policy",
  "more searches",
  "linkedin ©",
  "&copy;",
  "get notified about new",
  "sign in to create job alert",
  "explore top content on linkedin",
];

const EXACT_PAGE_CHROME_LINES = new Set([
  "language",
  "seniority level",
  "employment type",
  "job function",
  "industries",
]);

const SCOPED_DESCRIPTION_NOISE_LINES = new Set([
  "apply",
  "save",
  "sign in",
  "join now",
  "show more",
  "show less",
  "email or phone",
  "password",
  "forgot password?",
]);

const SECTION_LINE_PATTERN =
  /^(about the job|responsibilities|requirements|qualifications|location|remote|hybrid|on-?site|onsite|job description)$/i;

export type HtmlJobMetadata = {
  companyName: string;
  positionTitle: string;
  salary: string;
  location: string;
};

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeLine(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeForMatching(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .toLowerCase();
}

function exactLineKey(value: string): string {
  return canonicalizeForMatching(normalizeLine(value))
    .replace(/^[\s:;,.!?()[\]{}"'`*_/-]+/, "")
    .replace(/[\s:;,.!?()[\]{}"'`*_/-]+$/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cueRegExp(cue: string): RegExp {
  const prefix = /^\w/.test(cue) ? "\\b" : "";
  const suffix = /\w$/.test(cue) ? "\\b" : "";
  return new RegExp(`${prefix}${escapeRegExp(cue)}${suffix}`, "i");
}

function cueMatches(line: string, cue: string): boolean {
  return cueRegExp(cue).test(line);
}

function cueIndex(line: string, cue: string): number {
  return cueRegExp(cue).exec(line)?.index ?? -1;
}

function splitCleanLines(value: string): string[] {
  return value
    .split(/\r?\n+/g)
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 1);
}

function splitLongLine(value: string): string[] {
  const normalized = normalizeLine(value);
  if (!normalized) {
    return [];
  }

  if (normalized.length < 260) {
    return [normalized];
  }

  const segmented = normalized
    .replace(/\s+\|\s+/g, "\n")
    .replace(/([.!?])\s+/g, "$1\n")
    .replace(
      /\s+(What do we do|Who we are|About us|Our mission and customers|Our journey|Our beliefs|AI at Qonto|The Role|What you'll do|As a Frontend Engineer|What you can expect|We'd love to hear from you if you|Impact you'll have in this role|About You|Our hiring process|Responsibilities|Requirements|Qualifications|Job Description|Similar jobs|People also viewed|Similar searches|Language)\b/gi,
      "\n$1",
    );

  const split = splitCleanLines(segmented);
  return split.length > 0 ? split : [normalized];
}

function expandLines(lines: string[]): string[] {
  return lines.flatMap((line) => splitLongLine(line));
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(line);
  }

  return result;
}

function isNoiseLine(line: string): boolean {
  const lower = canonicalizeForMatching(line);
  if (line.length > 220 && START_CUES.some((cue) => lower.includes(cue))) {
    return false;
  }

  if (EXACT_PAGE_CHROME_LINES.has(exactLineKey(line))) {
    return true;
  }

  if (NOISE_PATTERNS.some((pattern) => pattern.test(lower))) {
    return true;
  }

  return /^(jobs|people|learning|about|accessibility|user agreement)$/i.test(line);
}

function isStopLine(line: string): boolean {
  return EXACT_PAGE_CHROME_LINES.has(exactLineKey(line)) || STOP_CUES.some((cue) => cueMatches(line, cue));
}

function sliceRelevantWindow(lines: string[]): string[] {
  const lowered = lines.map((line) => canonicalizeForMatching(line));
  const startIndex = lowered.findIndex((line) => START_CUES.some((cue) => line.includes(cue)));
  const stopIndex = lowered.findIndex((line, index) =>
    index > Math.max(0, startIndex) && isStopLine(line),
  );

  if (startIndex === -1 && stopIndex === -1) {
    return lines;
  }

  const from = startIndex >= 0 ? Math.max(0, startIndex - 2) : 0;
  const to = stopIndex >= 0 && stopIndex > from ? stopIndex : lines.length;
  const header = lines.slice(0, Math.min(5, from));
  return dedupeLines([...header, ...lines.slice(from, to)]);
}

function postProcessLines(lines: string[]): string[] {
  const expanded = dedupeLines(expandLines(lines));
  const windowed = sliceRelevantWindow(expanded);
  return dedupeLines(windowed.filter((line) => !isNoiseLine(line)));
}

function isScopedDescriptionNoiseLine(line: string): boolean {
  return SCOPED_DESCRIPTION_NOISE_LINES.has(exactLineKey(line));
}

function postProcessLinkedInDescriptionLines(lines: string[]): string[] {
  const expanded = dedupeLines(expandLines(lines));
  return dedupeLines(expanded.filter((line) => !isScopedDescriptionNoiseLine(line)));
}

function linesToText(lines: string[]): string {
  return lines.join("\n").slice(0, MAX_VACANCY_TEXT_LENGTH).trim();
}

function windowedTextFromSingleLine(value: string): string {
  const normalized = normalizeLine(stripTags(value));
  if (!normalized) {
    return "";
  }

  const lower = canonicalizeForMatching(normalized);
  const startCandidates = START_CUES
    .map((cue) => lower.indexOf(cue))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const start = startCandidates[0] ?? 0;
  const from = start > 0 ? Math.max(0, start - 200) : 0;

  let sliced = normalized.slice(from);
  const slicedLower = canonicalizeForMatching(sliced);
  const stopCandidates = STOP_CUES
    .map((cue) => cueIndex(slicedLower, cue))
    .filter((index) => index > 0)
    .sort((a, b) => a - b);
  if (stopCandidates.length > 0) {
    sliced = sliced.slice(0, stopCandidates[0]);
  }

  const lines = postProcessLines(splitLongLine(sliced));
  if (lines.length > 0) {
    return linesToText(lines);
  }

  return normalizeLine(sliced).slice(0, MAX_VACANCY_TEXT_LENGTH);
}

function collectJobPostingNodes(value: unknown, target: Record<string, unknown>[]): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectJobPostingNodes(item, target);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const typeValue = record["@type"];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  const isJobPosting = types.some((entry) => typeof entry === "string" && entry.toLowerCase() === "jobposting");
  if (isJobPosting) {
    target.push(record);
  }

  for (const nested of Object.values(record)) {
    collectJobPostingNodes(nested, target);
  }
}

function extractOrganizationName(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const name = extractOrganizationName(item);
      if (name) {
        return name;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return typeof record.name === "string" ? normalizeWhitespace(record.name) : "";
  }

  return "";
}

function readScalarText(value: unknown): string {
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function uniqueJoin(parts: string[], separator = ", "): string {
  return [...new Set(parts.map((part) => normalizeWhitespace(part)).filter(Boolean))].join(separator);
}

function extractJobLocation(value: unknown): string {
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (Array.isArray(value)) {
    return uniqueJoin(value.map((item) => extractJobLocation(item)));
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const namedLocation = readScalarText(record.name);
  if (namedLocation) {
    return namedLocation;
  }

  const address = typeof record.address === "object" && record.address
    ? record.address as Record<string, unknown>
    : record;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => normalizeWhitespace(part));

  return uniqueJoin(parts);
}

function extractQuantitativeSalary(value: Record<string, unknown>, currency: string): string {
  const unit = readScalarText(value.unitText);
  const min = readScalarText(value.minValue);
  const max = readScalarText(value.maxValue);
  const exact = readScalarText(value.value);
  const amount = min && max ? `${min} - ${max}` : exact || min || max;

  if (!amount) {
    return "";
  }

  return normalizeWhitespace(`${currency ? `${currency} ` : ""}${amount}${unit ? ` / ${unit}` : ""}`);
}

function extractJobSalary(value: unknown, inheritedCurrency = ""): string {
  const scalar = readScalarText(value);
  if (scalar) {
    return scalar;
  }

  if (Array.isArray(value)) {
    return uniqueJoin(value.map((item) => extractJobSalary(item, inheritedCurrency)), " | ");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const currency = readScalarText(record.currency) || inheritedCurrency;

  if (record.value && typeof record.value === "object") {
    const nested = extractJobSalary(record.value, currency);
    if (nested) {
      return nested;
    }
  }

  return extractQuantitativeSalary(record, currency);
}

function collectJobPostingsFromHtml(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const postings: Record<string, unknown>[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const payload = $(element).contents().text().trim();
    if (!payload) {
      return;
    }

    try {
      collectJobPostingNodes(JSON.parse(payload), postings);
    } catch {
      // Ignore malformed JSON-LD and keep checking other signals.
    }
  });

  return postings;
}

function selectBestJobPosting(html: string): Record<string, unknown> | null {
  const postings = collectJobPostingsFromHtml(html);
  if (postings.length === 0) {
    return null;
  }

  return postings.sort((a, b) => {
    const aLength = typeof a.description === "string" ? a.description.length : 0;
    const bLength = typeof b.description === "string" ? b.description.length : 0;
    return bLength - aLength;
  })[0] ?? null;
}

function extractJobPostingText(html: string): string {
  const best = selectBestJobPosting(html);
  if (!best) {
    return "";
  }

  const title = typeof best.title === "string" ? normalizeWhitespace(best.title) : "";
  const company = extractOrganizationName(best.hiringOrganization);
  const location = extractJobLocation(best.jobLocation ?? best.applicantLocationRequirements);
  const salary = extractJobSalary(best.baseSalary ?? best.estimatedSalary);
  const lines = [
    title ? `Title: ${title}` : "",
    company ? `Company: ${company}` : "",
    location ? `Location: ${location}` : "",
    salary ? `Salary: ${salary}` : "",
    typeof best.employmentType === "string" ? `Employment type: ${normalizeWhitespace(best.employmentType)}` : "",
    typeof best.description === "string" ? `Description:\n${stripTags(best.description)}` : "",
    typeof best.responsibilities === "string" ? `Responsibilities:\n${stripTags(best.responsibilities)}` : "",
    typeof best.qualifications === "string" ? `Qualifications:\n${stripTags(best.qualifications)}` : "",
  ].filter(Boolean);

  return linesToText(postProcessLines(splitCleanLines(lines.join("\n"))));
}

export function extractJobPostingDescriptionFromHtml(html: string): string {
  const best = selectBestJobPosting(html);
  if (!best || typeof best.description !== "string") {
    return "";
  }

  return linesToText(postProcessLines(splitCleanLines(stripTags(best.description))));
}

function htmlToLines(html: string): string[] {
  const text = decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|section|article|main|h1|h2|h3|h4|h5|h6|ul|ol|tr|td|th)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");

  return splitCleanLines(text);
}

function extractLinkedInDescriptionText(html: string): string {
  const $ = cheerio.load(html);
  const selectors = [
    ".description__text .show-more-less-html__markup",
    ".show-more-less-html__markup",
    ".description__text",
  ];

  for (const selector of selectors) {
    const elements = $(selector).toArray();
    for (const element of elements) {
      const innerHtml = $(element).html() ?? "";
      const text = linesToText(postProcessLinkedInDescriptionLines(htmlToLines(innerHtml)));
      if (!isVacancyTextTooShort(text)) {
        return text;
      }
    }
  }

  return "";
}

function scoreText(value: string): number {
  const lower = canonicalizeForMatching(value);
  const keywordHits = START_CUES.filter((cue) => lower.includes(cue)).length;
  const noiseHits = NOISE_PATTERNS.filter((pattern) => pattern.test(lower)).length;
  return value.length + keywordHits * 300 - noiseHits * 500;
}

function readMetaContent($: cheerio.CheerioAPI, name: string): string {
  return normalizeWhitespace(
    $(`meta[property='${name}'], meta[name='${name}']`).attr("content") ?? "",
  );
}

function cleanTitleCandidate(value: string): string {
  return normalizeWhitespace(decodeHtmlEntities(value).replace(/\s*\|\s*linkedin\s*$/i, ""));
}

function readFirstSelectorText(
  $: cheerio.CheerioAPI,
  selectors: string[],
  accepts: (value: string) => boolean = Boolean,
): string {
  for (const selector of selectors) {
    for (const element of $(selector).toArray()) {
      const value = normalizeWhitespace($(element).text());
      if (accepts(value)) {
        return value;
      }
    }
  }

  return "";
}

function looksLikeSalary(value: string): boolean {
  return value.length <= 220 &&
    /(\$|€|£|₽|руб|usd|eur|gbp|cad|aud|salary|compensation|base pay|pay range|\d+\s*k\b|\d[\d\s,.]*(?:-|–|to)\s*\d|\d+\s*(?:per|\/)\s*(?:year|month|hour))/i.test(value);
}

function looksLikeLocation(value: string): boolean {
  return value.length <= 180 &&
    !looksLikeSalary(value) &&
    !/\b(applicants?|ago|posted|reposted|promoted|views?)\b/i.test(value);
}

function extractPrefixedLine(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
    const value = normalizeWhitespace(match?.[1] ?? "");
    if (value) {
      return value;
    }
  }

  return "";
}

export function extractSalaryFromText(text: string): string {
  return extractPrefixedLine(text, ["Salary", "Compensation", "Pay", "Base salary", "Base pay", "Pay range"]);
}

export function extractLocationFromText(text: string): string {
  return extractPrefixedLine(text, ["Location", "Job location", "Work location"]);
}

export function sanitizeVacancyText(value: string): string {
  const cleaned = linesToText(postProcessLines(splitCleanLines(stripTags(value))));
  if (cleaned.length > 0) {
    return cleaned;
  }
  return windowedTextFromSingleLine(value);
}

export function extractVisibleVacancyTextFromHtml(html: string): string {
  const linkedinDescriptionText = extractLinkedInDescriptionText(html);
  if (!isVacancyTextTooShort(linkedinDescriptionText)) {
    return linkedinDescriptionText;
  }

  return linesToText(postProcessLines(htmlToLines(html)));
}

export function extractVacancyTextFromHtml(html: string): string {
  const htmlText = extractVisibleVacancyTextFromHtml(html);
  const jsonLdText = extractJobPostingText(html);

  if (!jsonLdText) {
    return htmlText;
  }

  if (!htmlText) {
    return jsonLdText;
  }

  return scoreText(jsonLdText) >= scoreText(htmlText) ? jsonLdText : htmlText;
}

export function fallbackVacancyTextFromHtml(html: string): string {
  const lines = expandLines(htmlToLines(html));
  const stopIndex = lines.findIndex((line) => isStopLine(line));
  const sliced = stopIndex >= 0 ? lines.slice(0, stopIndex) : lines;
  return linesToText(dedupeLines(sliced));
}

export function isVacancyTextTooShort(value: string): boolean {
  return normalizeWhitespace(value).length < MIN_EFFECTIVE_VACANCY_TEXT_LENGTH;
}

export function stripJinaEnvelope(text: string): string {
  const lines = text.split(/\r?\n/g);
  const markdownIndex = lines.findIndex((line) => /^Markdown Content:\s*$/i.test(line.trim()));
  if (markdownIndex === -1) {
    return text;
  }
  return lines.slice(markdownIndex + 1).join("\n").trim();
}

export function extractCompanyRoleFromHtml(html: string): HtmlJobMetadata {
  const $ = cheerio.load(html);
  const structuredJob = selectBestJobPosting(html);
  const structuredTitle = readScalarText(structuredJob?.title);
  const structuredCompany = extractOrganizationName(structuredJob?.hiringOrganization);
  const structuredLocation = extractJobLocation(
    structuredJob?.jobLocation ?? structuredJob?.applicantLocationRequirements,
  );
  const structuredSalary = extractJobSalary(structuredJob?.baseSalary ?? structuredJob?.estimatedSalary);
  const topCardRole = normalizeWhitespace($(".topcard__title, .top-card-layout__title").first().text());
  const topCardCompany = normalizeWhitespace($(".topcard__org-name-link").first().text());
  const topCardLocation = readFirstSelectorText($, [
    ".topcard__flavor--bullet",
    ".job-search-card__location",
    ".sub-nav-cta__meta-text",
  ], looksLikeLocation);
  const topCardSalary = readFirstSelectorText($, [
    ".compensation__salary",
    ".salary",
    "[class*='salary']",
    "[class*='compensation']",
  ], looksLikeSalary);
  if (topCardCompany && topCardRole) {
    return {
      companyName: topCardCompany,
      positionTitle: topCardRole,
      salary: topCardSalary || structuredSalary,
      location: topCardLocation || structuredLocation,
    };
  }

  const ogTitle = readMetaContent($, "og:title");
  const titleTag = normalizeWhitespace($("title").first().text());
  const candidates = [ogTitle, titleTag]
    .filter(Boolean)
    .map(cleanTitleCandidate);

  for (const candidate of candidates) {
    const match = candidate.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+[^|]*$|\s*\|\s*linkedin\s*$|$)/i);
    if (!match) {
      continue;
    }

    const companyName = match[1]?.trim() ?? "";
    const positionTitle = (match[2] ?? "")
      .replace(/\s*\|\s*linkedin\s*$/i, "")
      .replace(/\s+-\s+(remote(?:\s+friendly)?|hybrid|on-?site|onsite)\b.*$/i, "")
      .trim();
    if (companyName && positionTitle) {
      return {
        companyName,
        positionTitle,
        salary: topCardSalary || structuredSalary,
        location: topCardLocation || structuredLocation,
      };
    }
  }

  return {
    companyName: topCardCompany || structuredCompany || readMetaContent($, "og:site_name"),
    positionTitle: topCardRole ||
      structuredTitle ||
      cleanTitleCandidate(ogTitle || titleTag || normalizeWhitespace($("h1").first().text())),
    salary: topCardSalary || structuredSalary,
    location: topCardLocation || structuredLocation,
  };
}

export function extractTitleFromText(text: string): string {
  const titleLine = text.match(/^Title:\s*(.+)$/im)?.[1]?.trim();
  if (titleLine) {
    return cleanTitleCandidate(titleLine);
  }

  const firstLine = firstUsefulLine(text);
  const linkedinHeader = firstLine.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+|\s+\|\s*linkedin|$)/i);
  if (linkedinHeader?.[2]) {
    return cleanTitleCandidate(linkedinHeader[2]);
  }

  return cleanTitleCandidate(firstLine);
}

export function extractCompanyFromText(text: string): string {
  const companyLine = text.match(/^Company:\s*(.+)$/im)?.[1]?.trim();
  if (companyLine) {
    return normalizeWhitespace(companyLine);
  }

  const firstLine = firstUsefulLine(text);
  const linkedinHeader = firstLine.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+|\s+\|\s*linkedin|$)/i);
  if (linkedinHeader?.[1]) {
    return normalizeWhitespace(linkedinHeader[1]);
  }

  const lines = usefulMetadataLines(text);
  const title = extractTitleFromText(text).toLowerCase();
  const matchedTitleIndex = lines.findIndex((line) => line.toLowerCase() === title);
  const startIndex = matchedTitleIndex >= 0 ? matchedTitleIndex + 1 : 0;
  const fallbackCompany = lines.slice(startIndex, startIndex + 3).find((line) =>
    !SECTION_LINE_PATTERN.test(line) &&
    !/^(united kingdom|united states|serbia|london|new york|remote)$/i.test(line) &&
    !/\b(applicants?|day|days|hour|hours|week|weeks|month|months)\s+ago\b/i.test(line),
  );

  return fallbackCompany ? normalizeWhitespace(fallbackCompany) : "";
}

function usefulMetadataLines(text: string): string[] {
  return text
    .split(/\r?\n/g)
    .map((line) => normalizeLine(line))
    .filter((line) =>
      line.length > 0 &&
      line.length <= 180 &&
      !/^(apply|save|sign in|join now|linkedin|job description)$/i.test(line),
    );
}

function firstUsefulLine(text: string): string {
  return usefulMetadataLines(text)[0] ?? "";
}
