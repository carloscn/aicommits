import { execa, execaSync } from 'execa';
import { KnownError } from './error.js';
import type { CommitType } from './config-types.js';
import { generatePrompt, generateDescriptionPrompt } from './prompt.js';
import { isHeadless } from './headless.js';

export const CURSOR_AGENT_BASE_URL = 'cursor://agent';

/** Smaller diff = faster agent. Set `AICOMMITS_CURSOR_MAX_DIFF_CHARS` (2000–100000). */
export function getCursorAgentMaxDiffChars(): number {
	const raw = process.env.AICOMMITS_CURSOR_MAX_DIFF_CHARS;
	if (raw && /^\d+$/.test(raw)) {
		return Math.max(2000, Math.min(100_000, Number(raw)));
	}
	return 16_000;
}

function truncateDiffForCursorAgent(diff: string): string {
	const cap = getCursorAgentMaxDiffChars();
	if (diff.length <= cap) return diff;
	return (
		diff.slice(0, cap) +
		'\n\n[Diff truncated for speed; summarize only visible changes.]'
	);
}

/** Avoid a second `agent` round-trip when the line is slightly over max-length. */
export function truncateCommitSubjectForLength(msg: string, maxLen: number): string {
	if (msg.length <= maxLen) return msg;
	let s = msg.slice(0, maxLen);
	const lastSpace = s.lastIndexOf(' ');
	if (lastSpace > Math.floor(maxLen * 0.6)) {
		s = s.slice(0, lastSpace);
	}
	const t = s.trim();
	return t.length > 0 ? t : msg.slice(0, maxLen).trim();
}

const shouldLogDebug = () =>
	Boolean(process.env.DEBUG || process.env.AICOMMITS_DEBUG) && !isHeadless();

const extractResponseFromReasoning = (message: string): string => {
	const thinkPattern = /<think>[\s\S]*?<\/think>/gi;
	let cleaned = message.replace(thinkPattern, '');
	cleaned = cleaned.trim();
	return cleaned;
};

const sanitizeMessage = (message: string) => {
	let processed = extractResponseFromReasoning(message);
	const sanitized = processed
		.trim()
		.split('\n')[0]
		.replace(/(\w)\.$/, '$1')
		.replace(/^["'`]|["'`]$/g, '')
		.replace(/^<[^>]*>\s*/, '');
	return sanitized;
};

const sanitizeDescription = (message: string) => {
	let processed = extractResponseFromReasoning(message);
	return processed
		.trim()
		.replace(/^["'`]|["'`]$/g, '')
		.replace(/^<[^>]*>\s*/, '');
};

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

export function getCursorAgentBinary(): string {
	return (process.env.AICOMMITS_CURSOR_AGENT || 'agent').trim();
}

export function isCursorAgentBinaryRunnable(binary: string): boolean {
	try {
		execaSync(binary, ['-v'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

export function stripAnsiSequences(text: string): string {
	return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/** Parse lines like `composer-2-fast - Composer 2 Fast` from `agent --list-models` output. */
export function parseAgentModelsList(stdout: string): string[] {
	const plain = stripAnsiSequences(stdout);
	const models: string[] = [];
	for (const line of plain.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (/^available models$/i.test(trimmed)) continue;
		if (/^loading models/i.test(trimmed)) continue;
		const match = /^([a-z0-9][a-z0-9.-]*)\s+-\s+/i.exec(trimmed);
		if (match) models.push(match[1]);
	}
	return models;
}

/**
 * Never pass `CURSOR_API_KEY` in the child environment: Cursor CLI treats it as
 * higher priority than `agent login`, so a stale shell export breaks login-only use.
 * When a key is needed, pass `--api-key` on the argv instead (see runCursorAgentPrint).
 */
export function buildCursorAgentProcessEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.CURSOR_API_KEY;
	return env;
}

export async function runCursorAgentPrint(options: {
	binary: string;
	prompt: string;
	model: string;
	workspace: string;
	apiKey?: string;
	timeout: number;
}): Promise<string> {
	const { binary, prompt, model, workspace, apiKey, timeout } = options;
	const args = [
		...(apiKey ? (['--api-key', apiKey] as const) : []),
		'--sandbox',
		'disabled',
		'-p',
		prompt,
		'--print',
		'--output-format',
		'text',
		'--model',
		model,
		'--workspace',
		workspace,
		'--mode',
		'ask',
		'--trust',
	];
	const subprocess = execa(binary, args, {
		cwd: workspace,
		env: buildCursorAgentProcessEnv(),
		timeout,
		reject: false,
		all: true,
	});
	const result = await subprocess;
	if (result.timedOut) {
		throw new KnownError(
			`Cursor Agent timed out after ${timeout / 1000} seconds. Try increasing the timeout config or using a faster model.`
		);
	}
	if (result.failed) {
		const detail =
			(result.stderr || result.stdout || '').trim() ||
			(result as { message?: string }).message ||
			'unknown error';
		const loginHint =
			/api key is invalid|invalid.*key|authentication/i.test(detail) && apiKey
				? ' Remove or replace OPENAI_API_KEY in ~/.aicommits for this provider, or run `aicommits config set OPENAI_API_KEY=` to use `agent login` only.'
				: '';
		throw new KnownError(
			`Cursor Agent CLI failed (${result.exitCode ?? 'unknown'}): ${detail}${loginHint}`
		);
	}
	return (result.stdout || '').trim();
}

export type GenerateCommitMessageCursorAgentOptions = {
	model: string;
	locale: string;
	diff: string;
	completions: number;
	maxLength: number;
	type: CommitType;
	timeout: number;
	customPrompt?: string;
	workspace: string;
	apiKey?: string;
};

const emptyUsage = {
	prompt_tokens: 0,
	completion_tokens: 0,
	total_tokens: 0,
};

export const generateCommitMessageCursorAgent = async ({
	model,
	locale,
	diff,
	completions,
	maxLength,
	type,
	timeout,
	customPrompt,
	workspace,
	apiKey,
}: GenerateCommitMessageCursorAgentOptions) => {
	if (shouldLogDebug()) {
		console.log('Diff being sent to Cursor Agent:');
		console.log(diff);
	}

	const binary = getCursorAgentBinary();
	const system = generatePrompt(locale, maxLength, type, customPrompt);
	const diffForAgent = truncateDiffForCursorAgent(diff);
	const speedRules = `\n\n[Speed: output a single commit subject line only, at most ${maxLength} characters. No preamble, bullets, or analysis.]`;
	const fullPrompt = `${system}${speedRules}\n\n---\n\nStaged git diff (unified format):\n\n${diffForAgent}`;

	try {
		const promises = Array.from({ length: completions }, () =>
			runCursorAgentPrint({
				binary,
				prompt: fullPrompt,
				model,
				workspace,
				apiKey,
				timeout,
			})
		);
		const texts = await Promise.all(promises);
		const messages = deduplicateMessages(
			texts
				.map((t) => sanitizeMessage(t))
				.map((m) => truncateCommitSubjectForLength(m, maxLength))
		);

		return { messages, usage: emptyUsage };
	} catch (error) {
		const errorAsAny = error as any;
		if (
			errorAsAny.name === 'AbortError' ||
			errorAsAny.message?.includes('aborted') ||
			errorAsAny.message?.includes('timed out') ||
			errorAsAny.isCanceled
		) {
			throw new KnownError(
				`Cursor Agent timed out after ${timeout / 1000} seconds. Try a faster model or increase timeout in config.`
			);
		}
		throw error;
	}
};

export type GenerateCommitDescriptionCursorAgentOptions = {
	model: string;
	locale: string;
	title: string;
	diff: string;
	timeout: number;
	maxLength: number;
	customPrompt?: string;
	workspace: string;
	apiKey?: string;
};

export const generateCommitDescriptionCursorAgent = async ({
	model,
	locale,
	title,
	diff,
	timeout,
	maxLength,
	customPrompt,
	workspace,
	apiKey,
}: GenerateCommitDescriptionCursorAgentOptions) => {
	const binary = getCursorAgentBinary();
	const system = generateDescriptionPrompt(locale, maxLength, customPrompt);
	const diffForAgent = truncateDiffForCursorAgent(diff);
	const speedRules =
		'\n\n[Speed: write the commit body only, no preamble or meta-commentary.]';
	const user = `Commit message title:\n${title}\n\nCode diff:\n${diffForAgent}`;
	const fullPrompt = `${system}${speedRules}\n\n---\n\n${user}`;
	const resultText = await runCursorAgentPrint({
		binary,
		prompt: fullPrompt,
		model,
		workspace,
		apiKey,
		timeout,
	});
	return { description: sanitizeDescription(resultText), usage: emptyUsage };
};

export type CombineCommitMessagesCursorAgentOptions = {
	messages: string[];
	model: string;
	locale: string;
	maxLength: number;
	type: CommitType;
	timeout: number;
	customPrompt?: string;
	workspace: string;
	apiKey?: string;
};

export const combineCommitMessagesCursorAgent = async ({
	messages,
	model,
	locale: _locale,
	maxLength,
	type: _type,
	timeout,
	customPrompt: _customPrompt,
	workspace,
	apiKey,
}: CombineCommitMessagesCursorAgentOptions) => {
	const binary = getCursorAgentBinary();
	const system = `You are a tool that generates git commit messages. Your task is to combine multiple commit messages into one.

Input: Several commit messages separated by newlines.
Output: A single commit message starting with type like 'feat:' or 'fix:'.

Do not add thanks, explanations, or any text outside the commit message. The final line must be at most ${maxLength} characters when applicable.`;
	const speedRules =
		'\n\n[Speed: output one commit subject line only, no explanation.]';
	const fullPrompt = `${system}${speedRules}\n\n${messages.join('\n')}`;

	const out = await runCursorAgentPrint({
		binary,
		prompt: fullPrompt,
		model,
		workspace,
		apiKey,
		timeout,
	});
	const combinedMessage = truncateCommitSubjectForLength(
		sanitizeMessage(out),
		maxLength
	);
	return { messages: [combinedMessage], usage: emptyUsage };
};
