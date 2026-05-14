---
name: generate-backend-copilot-instructions
description: Generate repository-specific backend AI instruction files for GitHub Copilot and Codex-style agents. Use when asked to create, update, scaffold, or refresh `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, or `.github/agents/*.agent.md` from a backend project's filesystem, package scripts, modules, framework, and source conventions.
---

# Backend AI Instructions

Use this skill to generate GitHub Copilot backend instruction files that match the current project instead of copying generic templates.

## Tool

Run the bundled generator:

```bash
node ./scripts/generate-backend-copilot-instructions.mjs --target <project>
```

Run this command from this skill directory. If you are in the repository root of this package instead, use:

```bash
node ./skills/generate-backend-copilot-instructions/scripts/generate-backend-copilot-instructions.mjs --target <project>
```

If installed as a package:

```bash
npx create-backend-copilot-instructions --target <project>
```

## Workflow

1. Clarify user requirements when they affect generated content, for example architecture rules, review standards, security emphasis, or team conventions.
2. Run with `--dry-run` first unless the user explicitly asked to write files.
3. Review the detected project summary in the command output.
4. Run without `--dry-run` to create instruction files.
5. Existing files are skipped by default. Use `--force` only when the user wants regeneration.

## Agent Files

Do not generate `.github/agents/*.agent.md` by default.

Generate custom agents only when the user asks for them or when there is a clear project need and the user confirms it. Before generating agents, ask which agents are needed and what each agent should focus on. Pass that answer with `--agents` and `--agent-direction`.

## Options

| Option | Description |
| ------ | ----------- |
| `--target <path>` | Project directory to inspect and write into. Defaults to the current working directory. |
| `--requirement <text>` | User/project requirement to include in `.github/copilot-instructions.md`. Can be repeated. |
| `--dry-run` | Show detected project facts and files that would be written. |
| `--force` | Overwrite existing generated files. |
| `--agents <list>` | Generate requested agents, using comma-separated names such as `bugfix,codereview`, or `all`. |
| `--agent-direction <text>` | Required with `--agents`; describes the expected agent focus and content direction. |
| `--help` | Show CLI help. |

## Output

The generator creates:

- `.github/copilot-instructions.md`
- Framework-specific `.github/instructions/*.instructions.md` files when detected
- Optional backend workflow agents under `.github/agents/` only when explicitly requested

The root Copilot file is generated from filesystem structure, `package.json` scripts, detected dependencies, source folders, test folders, and backend framework conventions.
