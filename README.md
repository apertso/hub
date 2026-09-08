# hub

## Scripts

- `skleika.sh` - Creates a single-file snapshot of the project's source code.

## job-parser

`@hub/job-parser` requires explicit initialization before `parseJob()`:

```ts
import { initializeJobParser, parseJob } from '@hub/job-parser';

initializeJobParser({
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  openRouter: {
    model: 'inclusionai/ling-3.0-flash',
    temperature: 0.2,
    top_p: 0.95,
    top_k: 20,
    max_tokens: 8192,
    reasoning: { enabled: false, effort: 'none' },
    chat_template_kwargs: { enable_thinking: false },
  },
});

const result = await parseJob('https://example.com/jobs/frontend-engineer');
```

`openRouter` is merged into the OpenRouter chat-completions JSON. Sampling, reasoning, provider routing, and other request fields can be set there; `messages`, `response_format`, and `stream` stay owned by the parser. `llmModel` still works as a shorthand for `openRouter.model`.

## skleika

`skleika` exports source files into `project_code.txt` in the current working directory.

It keeps a fast Bash implementation:

- inside Git repositories, it uses `git ls-files`
- outside Git repositories, it uses `ripgrep`
- the default target is `.`

## Install

Linux/macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/apertso/hub/main/install.sh | bash
```

Windows Git Bash:

```sh
curl -fsSL https://raw.githubusercontent.com/apertso/hub/main/install.sh | bash
```

Windows requires Git Bash. The installer places the Bash command at `~/bin/skleika` and also installs a PowerShell wrapper at `~/bin/skleika.ps1`. For PowerShell usage, add `C:\Users\<you>\bin` to your User `PATH`; PowerShell may also require local scripts to be allowed by your execution policy.

Re-running the installer overwrites the installed command with the latest repository version.

## Usage

```sh
skleika
skleika path/to/folder
skleika uninstall
skleika uninstall --yes
```

`skleika uninstall` asks for confirmation:

```text
Remove skleika? [y/N]
```

`skleika uninstall --yes` removes it without prompting.

## Dependencies

`skleika` expects Bash and standard Unix-style tools: `grep`, `xargs`, `awk`, and `sed`.

`git` is used for Git repository detection and the Git fast path. `ripgrep` is required only when running outside a Git repository.

Install `ripgrep`:

```sh
# Debian/Ubuntu
sudo apt install ripgrep

# macOS
brew install ripgrep

# Windows winget
winget install BurntSushi.ripgrep.MSVC

# Windows Chocolatey
choco install ripgrep

# Windows Scoop
scoop install ripgrep
```
