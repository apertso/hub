import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeJobParser, isJobParseSource, JOB_PARSE_SOURCES, parseJob } from "../src/index.js";
import { resetJobParserForTests } from "../src/parse.js";
import { detectSpecificSource, isHhUrl, isLeverUrl, isTeamtailorUrl } from "../src/utils/url.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const LINKEDIN_URL = "https://www.linkedin.com/jobs/view/4402429247/";
const RUBY_LINKEDIN_URL = "https://www.linkedin.com/jobs/view/4411409358";
const GREENHOUSE_URL = "https://job-boards.eu.greenhouse.io/brainrocketltd/jobs/4643018101";
const LEVER_URL = "https://jobs.lever.co/binance/8a4660a3-28de-41e6-bcaf-ef404c481338";
const HH_URL = "https://nn.hh.ru/vacancy/133066281";
const TEAMTAILOR_URL = "https://interventure.teamtailor.com/jobs/7674883-senior-ai-native-fullstack-engineer-ringier-team";

const LONG_DESCRIPTION = [
  "About the job",
  "Example Labs builds reliable software for customer-facing workflows across enterprise teams.",
  "As a Frontend Engineer, you will build product surfaces with React, TypeScript, and strong UI craft.",
  "You will collaborate with product, design, and backend engineers to ship accessible customer features.",
  "Requirements include production TypeScript experience, strong testing habits, and clear communication.",
].join("\n");

const SECTIONED_DESCRIPTION = [
  "Senior Frontend Engineer",
  "Example Labs",
  "About the role",
  "Example Labs builds reliable product surfaces for enterprise workflow teams.",
  "This role focuses on customer-facing dashboards, collaboration features, and accessible workflow tools.",
  "Key Responsibilities",
  "- Build accessible React and TypeScript interfaces for customer-facing dashboards.",
  "- Partner with product, design, and backend engineers to ship reliable product workflows.",
  "- Improve test coverage, frontend architecture, and performance for high-traffic features.",
  "Required experience",
  "- 5+ years building production web applications with React and TypeScript.",
  "- Strong testing habits, product judgment, and written communication.",
  "Benefits",
  "- Remote-first team with health coverage, learning budget, and flexible working hours.",
].join("\n");

const HH_DOM_FIXTURE = `
  <html>
    <body>
      <header>Навигация hh.ru</header>
      <main>
        <h1 data-qa="vacancy-title">Senior Fullstack Developer (Node.js + React)</h1>
        <a data-qa="vacancy-company-name">ООО&nbsp;Кидс Аппс</a>
        <span data-qa="vacancy-salary">от 300 000 ₽ на руки</span>
        <p data-qa="vacancy-view-location">Нижний Новгород</p>
        <div data-qa="vacancy-description">
          <p><strong>LogicLike — цифровая платформа для развития логики и мышления</strong> у детей и взрослых.</p>
          <p>Мы создаем образовательные продукты, которые помогают миллионам пользователей учиться через практику.</p>
          <p>Сейчас мы ищем Senior Fullstack Developer, который будет развивать продуктовую платформу на Node.js и React.</p>
          <ul>
            <li>Проектировать и развивать backend-сервисы на Node.js.</li>
            <li>Разрабатывать пользовательские интерфейсы на React и TypeScript.</li>
            <li>Участвовать в архитектурных решениях, ревью кода и улучшении инженерных процессов.</li>
          </ul>
          <p>Нам важно, чтобы кандидат умел самостоятельно доводить задачи до результата и бережно относился к качеству продукта.</p>
        </div>
        <aside>
          <div data-qa="vacancy-serp__vacancy_snippet_responsibility">
            Разрабатывать архитектуру и инфраструктуру для игровых проектов.
          </div>
          <div data-qa="vacancy-serp__vacancy_snippet_requirement">
            Опыт с Unity и игровыми backend-сервисами.
          </div>
        </aside>
      </main>
    </body>
  </html>
`;

const TEAMTAILOR_DOM_FIXTURE = `
  <html>
    <head>
      <title>Senior AI-Native Fullstack Engineer - Ringier Team - InterVenture</title>
      <meta property="og:title" content="Senior AI-Native Fullstack Engineer - Ringier Team - InterVenture" />
      <script type="application/ld+json">
        {
          "@context": "http://schema.org/",
          "@type": "JobPosting",
          "title": "Senior AI-Native Fullstack Engineer - Ringier Team",
          "description": "&lt;p&gt;Ringier is a leading international media and technology company based in Switzerland, with a strong presence in digital marketplaces, media, and data-driven solutions.&lt;/p&gt;&lt;p&gt;We are looking for a Senior Fullstack Engineer who has moved past the era of manual boilerplate.&lt;/p&gt;&lt;p&gt;&lt;strong&gt;Your responsibilities:&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Lead Agentic Workflows across the full TypeScript and Node.js stack.&lt;/li&gt;&lt;li&gt;Leverage AWS CDK and automated agents to deploy infrastructure-as-code.&lt;/li&gt;&lt;li&gt;Maintain standards for type-safety, security, and performance.&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Your Tech Stack knowledge: TypeScript, Node.js and AWS.&lt;/p&gt;",
          "identifier": {
            "@type": "PropertyValue",
            "name": "InterVenture",
            "value": "7674883"
          },
          "employmentType": "FULL_TIME",
          "hiringOrganization": {
            "@type": "Organization",
            "name": "InterVenture",
            "sameAs": "https://interventure.teamtailor.com"
          },
          "jobLocation": [
            {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Beograd",
                "addressCountry": "RS"
              }
            },
            {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Niš",
                "addressCountry": "RS"
              }
            },
            {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Novi Sad",
                "addressCountry": "RS"
              }
            }
          ]
        }
      </script>
    </head>
    <body class="jobs show">
      <main data-careersite--jobs--form-overlay-job-id-value="7674883">
        <h1 class="font-company-header">Senior AI-Native Fullstack Engineer - Ringier Team</h1>
        <section class="pt-20 pb-12">
          <div class="prose font-company-body" data-controller="careersite--responsive-video">
            <p>Ringier is a leading international media and technology company based in Switzerland.</p>
          </div>
        </section>
        <dl>
          <dt>Department</dt>
          <dd>Node</dd>
          <dt>Locations</dt>
          <dd>
            <a href="https://interventure.teamtailor.com/locations/belgrade">Belgrade</a>,
            <a href="https://interventure.teamtailor.com/locations/nis">Niš</a>,
            <a href="https://interventure.teamtailor.com/locations/novi-sad">Novi Sad</a>
          </dd>
        </dl>
      </main>
    </body>
  </html>
`;

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

function genericJobHtml(visibleDescription = "", structuredDescription = ""): string {
  const jsonLd = structuredDescription
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Senior Frontend Engineer",
        hiringOrganization: { name: "Example Labs" },
        description: structuredDescription,
      })}</script>`
    : "";

  return `
    <html>
      <head>${jsonLd}</head>
      <body><main>${visibleDescription.replace(/\n/g, "<br>")}</main></body>
    </html>
  `;
}

describe("parseJob", () => {
  afterEach(() => {
    resetJobParserForTests();
    vi.unstubAllGlobals();
  });

  it("exports JOB_PARSE_SOURCES and isJobParseSource for consumers", () => {
    expect(JOB_PARSE_SOURCES).toEqual([
      "linkedin",
      "greenhouse",
      "hh",
      "lever",
      "teamtailor",
      "jina",
      "direct",
    ]);
    expect(isJobParseSource("lever")).toBe(true);
    expect(isJobParseSource("teamtailor")).toBe(true);
    expect(isJobParseSource("manual")).toBe(false);
    expect(isJobParseSource(null)).toBe(false);
  });

  it("extracts LinkedIn guest title, company, and description without Groq", async () => {
    const linkedinGuestHtml = `
      <html>
        <body>
          <h2 class="top-card-layout__title topcard__title">Frontend Developer</h2>
          <a class="topcard__org-name-link">Synthesia</a>
          <span class="topcard__flavor topcard__flavor--bullet">London, England, United Kingdom</span>
          <div class="compensation__salary">Base pay range $120,000/yr - $150,000/yr</div>
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
    expect(result.location).toBe("London, England, United Kingdom");
    expect(result.salary).toBe("Base pay range $120,000/yr - $150,000/yr");
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

  it("keeps full LinkedIn descriptions when prose mentions industries and language", async () => {
    const linkedinGuestHtml = `
      <html>
        <body>
          <h1 class="top-card-layout__title topcard__title">Senior Full-Stack Developer (Next.js)</h1>
          <a class="topcard__org-name-link">Ruby Labs</a>
          <section class="core-section-container my-3 description">
            <div class="description__text description__text--rich">
              <section class="show-more-less-html" data-max-lines="5">
                <div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5 relative overflow-hidden">
                  <strong>About Us<br><br></strong>
                  Ruby Labs is a leading tech company that creates and operates innovative consumer products. We offer a diverse range of opportunities across the health, education, and entertainment industries. Our innovative teams are driving the future of consumer-led products, and we're always looking for passionate individuals to join us.<br><br>
                  <strong>About The Role<br><br></strong>
                  We’re building and scaling a profitable D2C platform used by hundreds of thousands of customers globally, processing large volumes of traffic and revenue every month. The product is well beyond MVP: it’s battle-tested in production, monetizing at scale, and now entering a phase of rapid growth and expansion.<br><br>
                  We're looking for a <strong>Senior Next.js Full-Stack Engineer </strong>who brings both technical depth and a sense of ownership. You won't just be shipping code, you'll be shaping architecture, improving reliability, and raising the engineering bar across a system that real users depend on every day.<br><br>
                  <strong><strong>Key Responsibilities<br><br></strong></strong>
                  <ul>
                    <li>Take ownership of core product components from concept to deployment.</li>
                    <li>Collaborate with the Product team to design scalable and maintainable architectures.</li>
                    <li>Participate in and lead code reviews and ensure best practices across the team.</li>
                    <li>Maintain high code quality and application performance in a fast-paced, high-traffic environment.</li>
                  </ul>
                  <strong>Qualifications<br><br></strong>
                  Core Technical Skills<br><br>
                  <ul>
                    <li>At least 4 years of experience with Next.js for full-stack application development.</li>
                    <li>Strong expertise in JavaScript/TypeScript and modern ReactJS.</li>
                    <li>Experience with CI/CD pipelines, Docker, and cloud infrastructure.</li>
                  </ul>
                  Leadership &amp; Collaboration<br><br>
                  <ul>
                    <li>Demonstrated ability to mentor other engineers and elevate team performance.</li>
                    <li>Fluency in Russian and/or Ukrainian language.</li>
                  </ul>
                  <strong><strong>Nice to have<br><br></strong></strong>
                  <ul>
                    <li>Experience in D2C SaaS products.</li>
                    <li>Experience working in a fast-paced, high-growth startup environment.</li>
                  </ul>
                </div>
              </section>
            </div>
          </section>
        </body>
      </html>
    `;
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4411409358") {
        return okResponse(linkedinGuestHtml);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(RUBY_LINKEDIN_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("linkedin");
    expect(result.companyName).toBe("Ruby Labs");
    expect(result.positionTitle).toBe("Senior Full-Stack Developer (Next.js)");
    expect(result.jobDescription.length).toBeGreaterThan(1_000);
    expect(result.jobDescription).toContain("About The Role");
    expect(result.jobDescription).toContain("Key Responsibilities");
    expect(result.jobDescription).toContain("Qualifications");
    expect(result.jobDescription).toContain("Nice to have");
    expect(result.jobDescription).toContain("Fluency in Russian and/or Ukrainian language");
    expect(result.warnings).not.toContain("Job description is short; result may be incomplete.");
  });

  it("uses the Greenhouse board API before generic fallbacks", async () => {
    const greenhousePayload = {
      title: "Senior Node.js Developer",
      company_name: "BrainRocket",
      location: { name: "Limassol, Cyprus" },
      metadata: [
        { name: "Salary range", value: "€70,000 - €90,000" },
      ],
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
    expect(result.location).toBe("Limassol, Cyprus");
    expect(result.salary).toBe("€70,000 - €90,000");
    expect(result.jobDescription).toContain("BrainRocket is a global company");
    expect(result.jobDescription).toContain("Requirements:");
    expect(result.jobDescription).not.toContain("Title:");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("detects lever.co job URLs as the Lever source", () => {
    expect(isLeverUrl(LEVER_URL)).toBe(true);
    expect(isLeverUrl("https://jobs.eu.lever.co/binance/8a4660a3-28de-41e6-bcaf-ef404c481338")).toBe(true);
    expect(isLeverUrl("https://jobs.lever.co/binance/8a4660a3-28de-41e6-bcaf-ef404c481338/apply")).toBe(true);
    expect(isLeverUrl("https://example.com/jobs/123")).toBe(false);
    expect(detectSpecificSource(LEVER_URL)).toBe("lever");
  });

  it("uses the Lever postings API before generic fallbacks", async () => {
    const leverPayload = {
      text: "Pioneer Talent Program - AI Agent Developer",
      workplaceType: "remote",
      categories: {
        location: "Asia",
        allLocations: ["Asia", "Hong Kong", "Taiwan, Taipei", "UAE, Dubai"],
      },
      openingPlain: [
        "Binance is a leading global blockchain ecosystem behind the world's largest cryptocurrency exchange by trading volume and registered users.",
        "We are trusted by over 230 million people in 100+ countries for our industry-leading security, user fund transparency, trading engine speed, deep liquidity, and an unmatched portfolio of digital-asset products.",
        "Binance offerings range from trading and finance to education, research, payments, institutional services, Web3 features, and more.",
      ].join(" "),
      lists: [
        {
          text: "About the Role",
          content: "<p>We are looking for an AI Agent Engineer to join our team as part of Tech Seeds 2026.</p><p>Design and build AI agent workflows and LLM-powered systems for real business use cases.</p>",
        },
        {
          text: "What We're Looking For",
          content: "<ul><li>Strong programming fundamentals in Java or Python.</li><li>Strong curiosity about LLMs, AI agents, tool use, retrieval, evaluation, and production AI systems.</li></ul>",
        },
      ],
      additionalPlain: "Competitive salary and company benefits. Work-from-home arrangement.",
    };
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === "https://api.lever.co/v0/postings/binance/8a4660a3-28de-41e6-bcaf-ef404c481338?mode=json") {
        return okJson(leverPayload);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(LEVER_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("lever");
    expect(result.companyName).toBe("Binance");
    expect(result.positionTitle).toBe("Pioneer Talent Program - AI Agent Developer");
    expect(result.location).toBe("Asia / Hong Kong / Taiwan, Taipei / UAE, Dubai / Remote");
    expect(result.jobDescription).toContain("Binance is a leading global blockchain ecosystem");
    expect(result.jobDescription).toContain("About the Role");
    expect(result.jobDescription).toContain("AI Agent Engineer");
    expect(result.jobDescription).toContain("What We're Looking For");
    expect(result.jobDescription).toContain("Competitive salary and company benefits");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("detects hh.ru and regional HH subdomains as the HH source", () => {
    expect(isHhUrl("https://hh.ru/vacancy/133066281")).toBe(true);
    expect(isHhUrl("https://nn.hh.ru/vacancy/133066281")).toBe(true);
    expect(isHhUrl("https://example.hh.ru/vacancy/133066281")).toBe(true);
    expect(isHhUrl("https://not-hh.ru/vacancy/133066281")).toBe(false);
    expect(detectSpecificSource("https://nn.hh.ru/vacancy/133066281")).toBe("hh");
  });

  it("extracts HH vacancy fields from scoped data-qa selectors without Groq", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === HH_URL) {
        return okResponse(HH_DOM_FIXTURE);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(HH_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("hh");
    expect(result.positionTitle).toBe("Senior Fullstack Developer (Node.js + React)");
    expect(result.companyName).toBe("ООО Кидс Аппс");
    expect(result.salary).toBe("от 300 000 ₽ на руки");
    expect(result.location).toBe("Нижний Новгород");
    expect(result.jobDescription).toContain("LogicLike — цифровая платформа для развития логики и мышления");
    expect(result.jobDescription).toContain("- Проектировать и развивать backend-сервисы на Node.js.");
    expect(result.jobDescription).not.toContain("Разрабатывать архитектуру и инфраструктуру для игровых проектов");
    expect(result.jobDescription).not.toContain("Опыт с Unity и игровыми backend-сервисами");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back from HH parsing to Jina and keeps fallback warnings", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === HH_URL) {
        return okResponse(`
          <h1 data-qa="vacancy-title">Senior Fullstack Developer (Node.js + React)</h1>
          <a data-qa="vacancy-company-name">ООО&nbsp;Кидс Аппс</a>
          <div data-qa="vacancy-description">Short.</div>
        `);
      }
      if (url === `https://r.jina.ai/${HH_URL}`) {
        return okResponse(`
          Title: Senior Backend Engineer
          URL Source: ${HH_URL}
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
          salary: "$140,000 - $180,000",
          location: "Remote, United States",
          jobDescription: LONG_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(HH_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("jina");
    expect(result.companyName).toBe("Example Labs");
    expect(result.positionTitle).toBe("Senior Backend Engineer");
    expect(result.salary).toBe("$140,000 - $180,000");
    expect(result.location).toBe("Remote, United States");
    expect(result.warnings.some((warning) => warning.includes("hh attempt failed"))).toBe(true);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      HH_URL,
      `https://r.jina.ai/${HH_URL}`,
      GROQ_URL,
    ]);
  });

  it("falls back from HH parsing through Jina to direct fetch", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    let hhFetchCount = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === HH_URL) {
        hhFetchCount += 1;
        if (hhFetchCount === 1) {
          return new Response("", { status: 500 });
        }
        return okResponse(`<main>${LONG_DESCRIPTION}</main>`);
      }
      if (url === `https://r.jina.ai/${HH_URL}`) {
        return new Response("", { status: 429 });
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

    const result = await parseJob(HH_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("direct");
    expect(result.companyName).toBe("Example Labs");
    expect(result.positionTitle).toBe("Frontend Engineer");
    expect(result.warnings.some((warning) => warning.includes("hh attempt failed"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("jina attempt failed"))).toBe(true);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      HH_URL,
      `https://r.jina.ai/${HH_URL}`,
      HH_URL,
      GROQ_URL,
    ]);
  });

  it("falls back from a specific source to Jina and normalizes through Groq", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
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

  it("falls back from Lever to Jina and normalizes through Groq", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "https://api.lever.co/v0/postings/binance/8a4660a3-28de-41e6-bcaf-ef404c481338?mode=json") {
        return new Response("", { status: 500 });
      }
      if (url === `https://r.jina.ai/${LEVER_URL}`) {
        return okResponse(`
          Title: Pioneer Talent Program - AI Agent Developer
          URL Source: ${LEVER_URL}
          Markdown Content:
          # Pioneer Talent Program - AI Agent Developer
          Binance
          ${LONG_DESCRIPTION}
        `, "text/plain; charset=utf-8");
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "Binance",
          positionTitle: "Pioneer Talent Program - AI Agent Developer",
          jobDescription: LONG_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(LEVER_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("jina");
    expect(result.companyName).toBe("Binance");
    expect(result.positionTitle).toBe("Pioneer Talent Program - AI Agent Developer");
    expect(result.warnings.some((warning) => warning.includes("lever attempt failed"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith(LEVER_URL, expect.anything());
  });

  it("detects teamtailor.com job URLs as the Teamtailor source", () => {
    expect(isTeamtailorUrl(TEAMTAILOR_URL)).toBe(true);
    expect(isTeamtailorUrl("https://example.teamtailor.com/jobs/12345-some-role")).toBe(true);
    expect(isTeamtailorUrl("https://example.teamtailor.com/jobs")).toBe(false);
    expect(isTeamtailorUrl("https://example.com/jobs/123")).toBe(false);
    expect(detectSpecificSource(TEAMTAILOR_URL)).toBe("teamtailor");
  });

  it("extracts Teamtailor JobPosting fields without Groq", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === TEAMTAILOR_URL) {
        return okResponse(TEAMTAILOR_DOM_FIXTURE);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(TEAMTAILOR_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("teamtailor");
    expect(result.companyName).toBe("InterVenture");
    expect(result.positionTitle).toBe("Senior AI-Native Fullstack Engineer - Ringier Team");
    expect(result.location).toBe("Belgrade / Niš / Novi Sad");
    expect(result.jobDescription).toContain("Ringier is a leading international media and technology company");
    expect(result.jobDescription).toContain("Your responsibilities:");
    expect(result.jobDescription).toContain("- Lead Agentic Workflows across the full TypeScript and Node.js stack.");
    expect(result.jobDescription).toContain("TypeScript, Node.js and AWS");
    expect(result.jobDescription).not.toContain("&lt;p&gt;");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back from Teamtailor to Jina and normalizes through Groq", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === TEAMTAILOR_URL) {
        return new Response("", { status: 500 });
      }
      if (url === `https://r.jina.ai/${TEAMTAILOR_URL}`) {
        return okResponse(`
          Title: Senior AI-Native Fullstack Engineer - Ringier Team
          URL Source: ${TEAMTAILOR_URL}
          Markdown Content:
          # Senior AI-Native Fullstack Engineer - Ringier Team
          InterVenture
          ${LONG_DESCRIPTION}
        `, "text/plain; charset=utf-8");
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "InterVenture",
          positionTitle: "Senior AI-Native Fullstack Engineer - Ringier Team",
          jobDescription: LONG_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(TEAMTAILOR_URL);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("jina");
    expect(result.companyName).toBe("InterVenture");
    expect(result.positionTitle).toBe("Senior AI-Native Fullstack Engineer - Ringier Team");
    expect(result.warnings.some((warning) => warning.includes("teamtailor attempt failed"))).toBe(true);
  });

  it("accepts a generic job when Jina and direct descriptions agree", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const jobUrl = "https://example.com/jobs/verified-frontend-engineer";
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(SECTIONED_DESCRIPTION, "text/plain");
      }
      if (url === jobUrl) {
        return okResponse(genericJobHtml(SECTIONED_DESCRIPTION));
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "Example Labs",
          positionTitle: "Senior Frontend Engineer",
          salary: "",
          location: "Remote",
          jobDescription: SECTIONED_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(true);
    expect(result.diagnostics?.verificationStatus).toBe("verified");
    expect(result.diagnostics?.selectedSource).toBeDefined();
    expect(result.diagnostics?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "jina", ok: true, textLength: expect.any(Number) }),
      expect.objectContaining({ source: "direct", ok: true, textLength: expect.any(Number) }),
    ]));
    expect(result.diagnostics?.comparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ leftSource: "jina", rightSource: "direct", agrees: true }),
    ]));
  });

  it("rejects a generic job when Jina appears truncated relative to direct", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const jobUrl = "https://example.com/jobs/truncated-frontend-engineer";
    const truncatedDescription = SECTIONED_DESCRIPTION.split("Required experience")[0]?.trim() ?? "";
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(truncatedDescription, "text/plain");
      }
      if (url === jobUrl) {
        return okResponse(genericJobHtml(SECTIONED_DESCRIPTION));
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("JOB_DESCRIPTION_INCOMPLETE");
    expect(result.diagnostics?.verificationStatus).toBe("incomplete");
    expect(result.diagnostics?.comparisons[0]).toEqual(expect.objectContaining({
      agrees: false,
      coverageRatio: expect.any(Number),
      missingSections: expect.arrayContaining(["requirements", "benefits"]),
    }));
    expect(fetchMock.mock.calls.some(([input]) => String(input) === GROQ_URL)).toBe(false);
  });

  it("rejects a generic job when a high-overlap source omits a complete section", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const jobUrl = "https://example.com/jobs/missing-benefits";
    const descriptionWithoutBenefits = SECTIONED_DESCRIPTION.split("Benefits")[0]?.trim() ?? "";
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(descriptionWithoutBenefits, "text/plain");
      }
      if (url === jobUrl) {
        return okResponse(genericJobHtml(SECTIONED_DESCRIPTION));
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("JOB_DESCRIPTION_INCOMPLETE");
    expect(result.diagnostics?.comparisons[0]).toEqual(expect.objectContaining({
      agrees: false,
      missingSections: expect.arrayContaining(["benefits"]),
    }));
  });

  it("rejects an unverified generic job when only Jina succeeds", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const jobUrl = "https://example.com/jobs/unverified-frontend-engineer";
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(SECTIONED_DESCRIPTION, "text/plain");
      }
      if (url === jobUrl) {
        return new Response("", { status: 503 });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("JOB_DESCRIPTION_UNVERIFIED");
    expect(result.diagnostics?.verificationStatus).toBe("unverified");
    expect(result.diagnostics?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "jina", ok: true }),
      expect.objectContaining({ source: "direct", ok: false, errorCode: "DIRECT_HTTP_ERROR" }),
      expect.objectContaining({ source: "jsonld", ok: false }),
    ]));
    expect(fetchMock.mock.calls.some(([input]) => String(input) === GROQ_URL)).toBe(false);
  });

  it("accepts a generic job when direct text and JSON-LD corroborate each other", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const jobUrl = "https://example.com/jobs/structured-frontend-engineer";
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return new Response("", { status: 429 });
      }
      if (url === jobUrl) {
        return okResponse(genericJobHtml(SECTIONED_DESCRIPTION, SECTIONED_DESCRIPTION));
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "Example Labs",
          positionTitle: "Senior Frontend Engineer",
          salary: "",
          location: "Remote",
          jobDescription: SECTIONED_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("direct");
    expect(result.diagnostics?.verificationStatus).toBe("verified");
    expect(result.diagnostics?.comparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ leftSource: "direct", rightSource: "jsonld", agrees: true }),
    ]));
  });

  it("returns unverified when only direct JSON-LD succeeds", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
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
              "jobLocation": {
                "@type": "Place",
                "address": {
                  "@type": "PostalAddress",
                  "addressLocality": "Austin",
                  "addressRegion": "TX",
                  "addressCountry": "US"
                }
              },
              "baseSalary": {
                "@type": "MonetaryAmount",
                "currency": "USD",
                "value": {
                  "@type": "QuantitativeValue",
                  "minValue": 140000,
                  "maxValue": 180000,
                  "unitText": "YEAR"
                }
              },
              "description": "<p>${LONG_DESCRIPTION.replace(/\n/g, " ")}</p>"
            }
          </script>
        </head>
        <body></body>
      </html>
    `;
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return new Response("", { status: 429 });
      }
      if (url === jobUrl) {
        return okResponse(directHtml);
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(false);
    expect(result.source).toBe("direct");
    expect(result.errorCode).toBe("JOB_DESCRIPTION_UNVERIFIED");
    expect(result.diagnostics?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "jsonld", ok: true }),
      expect.objectContaining({ source: "direct", ok: false }),
    ]));
    expect(fetchMock.mock.calls.some(([input]) => String(input) === GROQ_URL)).toBe(false);
  });

  it("falls back to cleaned source text when Groq returns only one description section", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const jobUrl = "https://example.com/jobs/section-only";
    const partialGroqDescription = [
      "Key Responsibilities",
      "- Build accessible React and TypeScript interfaces for customer-facing dashboards.",
      "- Partner with product, design, and backend engineers to ship reliable product workflows.",
    ].join("\n");
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(SECTIONED_DESCRIPTION, "text/plain");
      }
      if (url === jobUrl) {
        return okResponse(genericJobHtml(SECTIONED_DESCRIPTION));
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "Example Labs",
          positionTitle: "Senior Frontend Engineer",
          salary: "",
          location: "Remote",
          jobDescription: partialGroqDescription,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("jina");
    expect(result.jobDescription).toContain("About the role");
    expect(result.jobDescription).toContain("Required experience");
    expect(result.jobDescription).toContain("Benefits");
    expect(result.jobDescription).not.toBe(partialGroqDescription);
    expect(result.warnings).toContain("Groq returned incomplete jobDescription; using cleaned source text.");
  });

  it("preserves verified source text beyond the Groq input limit", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const jobUrl = "https://example.com/jobs/long-description";
    const tailMarker = "COMPLETE_DESCRIPTION_TAIL_MARKER";
    const longDescription = [
      SECTIONED_DESCRIPTION,
      ...Array.from(
        { length: 360 },
        (_, index) => `Project context ${index}: collaborate across engineering, product, and design on reliable customer workflows.`,
      ),
      tailMarker,
    ].join("\n");
    expect(longDescription.length).toBeGreaterThan(20_000);
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(longDescription, "text/plain");
      }
      if (url === jobUrl) {
        return okResponse(genericJobHtml(longDescription));
      }
      if (url === GROQ_URL) {
        return groqResponse({
          companyName: "Example Labs",
          positionTitle: "Senior Frontend Engineer",
          salary: "",
          location: "Remote",
          jobDescription: SECTIONED_DESCRIPTION,
          warnings: [],
        });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseJob(jobUrl);

    expect(result.ok).toBe(true);
    expect(result.jobDescription).toContain(tailMarker);
    expect(result.warnings).toContain(
      "Groq input exceeded 20000 characters; using cleaned source text to preserve full coverage.",
    );
    const groqCall = fetchMock.mock.calls.find(([input]) => String(input) === GROQ_URL);
    expect(String(groqCall?.[1]?.body)).not.toContain(tailMarker);
  });

  it("adds a warning when Groq returns a section heading as the title", async () => {
    initializeJobParser({ groqApiKey: "test-groq-key" });
    const jobUrl = "https://example.com/jobs/unclear";
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === `https://r.jina.ai/${jobUrl}`) {
        return okResponse(`${LONG_DESCRIPTION}\nMore details about product engineering and quality ownership.`, "text/plain");
      }
      if (url === jobUrl) {
        return okResponse(genericJobHtml(`${LONG_DESCRIPTION}\nMore details about product engineering and quality ownership.`));
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
    expect(result.salary).toBe("");
    expect(result.location).toBe("");
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
    expect(result.warnings.some((warning) => warning.includes("initializeJobParser"))).toBe(true);
  });
});
