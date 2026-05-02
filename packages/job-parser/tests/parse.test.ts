import { afterEach, describe, expect, it, vi } from "vitest";
import { parseJob } from "../src/index.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const LINKEDIN_URL = "https://www.linkedin.com/jobs/view/4402429247/";
const GREENHOUSE_URL = "https://job-boards.eu.greenhouse.io/brainrocketltd/jobs/4643018101";

const LONG_DESCRIPTION = [
  "About the job",
  "Example Labs builds reliable software for customer-facing workflows across enterprise teams.",
  "As a Frontend Engineer, you will build product surfaces with React, TypeScript, and strong UI craft.",
  "You will collaborate with product, design, and backend engineers to ship accessible customer features.",
  "Requirements include production TypeScript experience, strong testing habits, and clear communication.",
].join("\n");

function okResponse(body: string, contentType = "text/html; charset=utf-8"): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

function okJson(body: unknown): Response {
  return okResponse(JSON.stringify(body), "application/json; charset=utf-8");
}

function groqResponse(body: unknown): Response {
  return okJson({
    choices: [
      {
        message: {
          content: JSON.stringify(body),
        },
      },
    ],
  });
}

describe("parseJob", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("extracts LinkedIn guest title, company, and description without Groq", async () => {
    const linkedinGuestHtml = `
      <html>
        <body>
          <h2 class="top-card-layout__title topcard__title">Frontend Developer</h2>
          <a class="topcard__org-name-link">Synthesia</a>
          <section class="core-section-container my-3 description">
            <div class="description__text description__text--rich">
              <section class="show-more-less-html">
                <div class="show-more-less-html__markup">
                  <h3>About the job</h3>
                  <p>Synthesia is the world's leading AI video platform for business, used by global enterprises.</p>
                  <p>As a Frontend Developer, you will build product surfaces with React, TypeScript, and strong UI craft.</p>
                  <p>You will collaborate with product, design, and backend engineers to ship accessible customer features.</p>
                </div>
              </section>
            </div>
          </section>
        </body>
      </html>
    `;
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4402429247") {
        return okResponse(linkedinGuestHtml);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(LINKEDIN_URL);

    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://www.linkedin.com/jobs/view/4402429247");
    expect(result.source).toBe("linkedin");
    expect(result.companyName).toBe("Synthesia");
    expect(result.positionTitle).toBe("Frontend Developer");
    expect(result.jobDescription).toContain("About the job");
    expect(result.jobDescription).not.toContain("top-card-layout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not truncate LinkedIn descriptions when prose mentions languages", async () => {
    const linkedinGuestHtml = `
      <html>
        <body>
          <h1 class="top-card-layout__title topcard__title">Senior Full Stack Engineer - EMEA</h1>
          <a class="topcard__org-name-link">Deel</a>
          <section class="core-section-container my-3 description">
            <div class="description__text description__text--rich">
              <section class="show-more-less-html" data-max-lines="5">
                <div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5 relative overflow-hidden">
                  <strong>Who We Are Is What We Do.<br><br></strong>
                  Deel is the all-in-one payroll and HR platform for global teams. Our vision is to unlock global opportunity for every person, team, and business. Built for the way the world works today, Deel combines HRIS, payroll, compliance, benefits, performance, and equipment management into one seamless platform.<br><br>
                  Among the largest globally distributed companies in the world, our team of 7,000 spans more than 100 countries, speaks 74 languages, and brings a connected and dynamic culture that drives continuous learning and innovation for our customers.<br><br>
                  <strong>Summary<br><br></strong>
                  The Senior Full Stack Engineer is responsible for designing, developing, and maintaining both the front-end and back-end components of Deel's platform.<br><br>
                  <strong>Responsibilities<br><br></strong>
                  <ul>
                    <li>You will develop high-quality, responsive web applications using TypeScript, Javascript, React, and Express.</li>
                    <li>You will create and optimize database schemas, queries, and interactions with Postgres.</li>
                  </ul>
                </div>
              </section>
            </div>
          </section>
        </body>
      </html>
    `;
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4402429247") {
        return okResponse(linkedinGuestHtml);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(LINKEDIN_URL);

    expect(result.ok).toBe(true);
    expect(result.jobDescription).toContain("speaks 74 languages");
    expect(result.jobDescription).toContain("Summary");
    expect(result.jobDescription).toContain("You will develop high-quality");
  });

  it("uses the Greenhouse board API before generic fallbacks", async () => {
    const greenhousePayload = {
      title: "Senior Node.js Developer",
      company_name: "BrainRocket",
      content: [
        "&lt;div&gt;&lt;p&gt;BrainRocket is a global company creating end-to-end tech products for fintech clients.&lt;/p&gt;&lt;/div&gt;",
        "&lt;div&gt;&lt;p&gt;We are looking for a skilled Senior Node.js Developer to join our product engineering team.&lt;/p&gt;",
        "&lt;p&gt;&lt;strong&gt;Requirements:&lt;/strong&gt;&lt;br&gt;Strong JavaScript and TypeScript knowledge.&lt;br&gt;",
        "3+ years of commercial experience with Node.js, Redis, MongoDB, and MySQL.&lt;/p&gt;&lt;/div&gt;",
      ].join(""),
    };
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === "https://boards-api.greenhouse.io/v1/boards/brainrocketltd/jobs/4643018101") {
        return okJson(greenhousePayload);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(GREENHOUSE_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("greenhouse");
    expect(result.companyName).toBe("BrainRocket");
    expect(result.positionTitle).toBe("Senior Node.js Developer");
    expect(result.jobDescription).toContain("BrainRocket is a global company");
    expect(result.jobDescription).toContain("Requirements:");
    expect(result.jobDescription).not.toContain("Title:");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back from a specific source to Jina and normalizes through Groq", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "https://boards-api.greenhouse.io/v1/boards/brainrocketltd/jobs/4643018101") {
        return new Response("", { status: 500 });
      }
      if (url === `https://r.jina.ai/${GREENHOUSE_URL}`) {
        return okResponse(`
          Title: Senior Backend Engineer
          URL Source: ${GREENHOUSE_URL}
          Markdown Content:
          # Senior Backend Engineer
          Example Labs
          ${LONG_DESCRIPTION}
        `, "text/plain; charset=utf-8");
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "Example Labs",
          positionTitle: "Senior Backend Engineer",
          jobDescription: LONG_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(GREENHOUSE_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("jina");
    expect(result.companyName).toBe("Example Labs");
    expect(result.positionTitle).toBe("Senior Backend Engineer");
    expect(result.warnings.some((warning) => warning.includes("greenhouse attempt failed"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith(GREENHOUSE_URL, expect.anything());
  });

  it("falls back from Jina to direct fetch", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const jobUrl = "https://example.com/jobs/frontend-engineer";
    const directHtml = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Frontend Engineer",
              "hiringOrganization": { "name": "Example Labs" },
              "description": "<p>${LONG_DESCRIPTION.replace(/\n/g, " ")}</p>"
            }
          </script>
        </head>
        <body></body>
      </html>
    `;
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return new Response("", { status: 429 });
      }
      if (url === jobUrl) {
        return okResponse(directHtml);
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "Example Labs",
          positionTitle: "Frontend Engineer",
          jobDescription: LONG_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("direct");
    expect(result.companyName).toBe("Example Labs");
    expect(result.positionTitle).toBe("Frontend Engineer");
    expect(result.warnings.some((warning) => warning.includes("jina attempt failed"))).toBe(true);
  });

  it("adds a warning when Groq returns a section heading as the title", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const jobUrl = "https://example.com/jobs/unclear";
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(`${LONG_DESCRIPTION}\nMore details about product engineering and quality ownership.`, "text/plain");
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "Example Labs",
          positionTitle: "Requirements",
          jobDescription: LONG_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("jina");
    expect(result.warnings.some((warning) => warning.includes("section heading"))).toBe(true);
  });

  it("returns an error result for invalid URLs", async () => {
    const result = await parseJob("not a url");

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("INVALID_URL");
    expect(result.source).toBe("direct");
    expect(result.companyName).toBe("");
  });

  it("returns a Groq configuration error for generic URLs when the API key is missing", async () => {
    const jobUrl = "https://example.com/jobs/frontend-engineer";
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(`${LONG_DESCRIPTION}\nAdditional product details and delivery expectations.`, "text/plain");
      }
      if (String(input) === jobUrl) {
        return okResponse(`<main>${LONG_DESCRIPTION}</main>`);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("GROQ_API_KEY_MISSING");
    expect(result.warnings.some((warning) => warning.includes("GROQ_API_KEY is not configured"))).toBe(true);
  });
});
