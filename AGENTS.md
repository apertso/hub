# AGENTS

Load with `npx openskills read <name>`.

| Skill | Description |
|-------|-------------|
| `release` | Commit, tag, and publish a new `@hub/job-parser` version |

## Language support

- Keep parsing, validation, completeness checks, and acceptance criteria language-agnostic; the parser handles vacancies in many languages.
- Never make success or failure depend on vocabulary, section headings, stop words, or formatting conventions from English or any other specific language.
- Language-specific patterns may enrich extraction or diagnostics only when their absence or mismatch cannot reject an otherwise valid result.
- Prefer Unicode-aware structural and text-similarity signals, and cover new text heuristics with language-neutral or multilingual regression tests.
