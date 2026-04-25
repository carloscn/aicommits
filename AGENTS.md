# AGENTS.md

## Commands
- **Build:** `pnpm build` (uses pkgroll with minify)
- **Type check:** `pnpm type-check` (runs tsc)
- **Test all:** `pnpm test` (runs `tsx tests`)
- **Test single file:** `pnpm tsx tests/specs/<file>.ts`

## Architecture
CLI tool that generates git commit messages using AI (OpenAI/Together AI, Cursor Agent CLI, or any OpenAI compatible endpoint).
- `src/cli.ts` - Main entry point using cleye for CLI parsing
- `src/commands/` - CLI subcommands (aicommits, config, hook, model, pr, setup)
- `src/utils/` - Shared utilities (git, openai, config, prompts, `cursor-agent.ts` for Cursor CLI; optional `AICOMMITS_CURSOR_MAX_DIFF_CHARS` caps diff size for speed)
- `src/feature/` - Feature-specific logic
- `tests/specs/` - Test files using manten framework

## Code Style
- **Indentation:** Tabs (spaces for YAML)
- **Quotes:** Single quotes
- **Line endings:** LF
- **Module system:** ESM (`"type": "module"`)
- **TypeScript:** Strict mode, ES2020 target, Node16 module resolution
- **Imports:** Use `.js` extension for local imports (ESM requirement)
- **Final newline:** Required
