import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeJobParser, parseJob } from "../src/index.js";
import { resetJobParserForTests } from "../src/parse.js";
import { sanitizeVacancyText, stripJinaEnvelope } from "../src/utils/text.js";

const source = readFileSync(new URL("./fixtures/wisebits.txt", import.meta.url), "utf8");
const description = stripJinaEnvelope(source);
const requirements = description.slice(description.indexOf("*   5+"), description.indexOf("**Nice to have:**"));

afterEach(() => {
  resetJobParserForTests();
  vi.unstubAllGlobals();
});

describe("vacancy text coverage", () => {
  it("keeps the middle of a vacancy when its final salary sentence mentions requirements", () => {
    const cleaned = sanitizeVacancyText(description);
    for (const line of requirements.trim().split("\n")) {
      expect(cleaned).toContain(line.replace(/\s+/g, " ").trim());
    }
    expect(cleaned).toContain("Experience with PHP.");
    expect(cleaned).toContain("Relocation support:");
    expect(cleaned).toContain("€4,000");
    expect(sanitizeVacancyText(cleaned)).toBe(cleaned);
  });

  it.each([
    "https://wisebits.com/vacancies/162-fullstack-developer-jsnodejs",
    "https://planner.cubomet.ru/memos/fUVtLDqkmU8keCqJUP2vdm",
  ])("passes every requirement through fetching and model normalization for %s", async (url) => {
    initializeJobParser({ openRouterApiKey: "test-key" });
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input) === `https://r.jina.ai/${url}`) {
        return new Response(source);
      }
      if (String(input) === "https://openrouter.ai/api/v1/chat/completions") {
        const body = JSON.parse(init?.body as string);
        for (const skill of ["Node.js 18+", "SvelteKit", "MongoDB", "Kubernetes", "WebSockets", "PHP"]) {
          expect(body.messages[1].content).toContain(skill);
        }
        return Response.json({ choices: [{ message: { content: JSON.stringify({
          companyName: "Wisebits",
          positionTitle: "Fullstack Developer (JS/Node.js)",
          salary: "From €4,000 net per month",
          location: "Remote",
          jobDescription: description,
          warnings: [],
        }) } }] });
      }
      throw new Error(`Unexpected fetch: ${input}`);
    }));

    const result = await parseJob(url);
    expect(result.ok).toBe(true);
    expect(result.source).toBe("jina");
    for (const skill of ["Node.js 18+", "SvelteKit", "MongoDB", "Kubernetes", "WebSockets", "PHP"]) {
      expect(result.jobDescription).toContain(skill);
    }
    expect(result.jobDescription).toContain("Relocation support:");
    expect(result.jobDescription).toContain("€4,000");
  });

  it.each([
    ["Мы строим платформу для миллионов пользователей.", "Задачи и опыт", "Разработка сервисов на Node.js и SvelteKit.", "Salary depends on overall match with the role requirements."],
    ["私たちは動画配信サービスを開発しています。", "担当業務と経験", "Node.js と SvelteKit を使ったサービス開発。", "Compensation depends on qualifications."],
  ])("preserves source text around prose containing a start cue: %s", (...lines) => {
    lines.splice(1, 0, ...Array.from({ length: 8 }, (_, i) => `${i}: ${lines[2]}`));
    const text = lines.join("\n");
    expect(sanitizeVacancyText(text)).toBe(text);
    expect(sanitizeVacancyText(lines.join(" "))).toContain(lines[0]);
  });
});
