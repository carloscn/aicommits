import { Provider, type ProviderDef } from './base.js';
import {
	CURSOR_AGENT_BASE_URL,
	getCursorAgentBinary,
	isCursorAgentBinaryRunnable,
} from '../../utils/cursor-agent.js';

export const CursorAgentProviderDef: ProviderDef = {
	name: 'cursoragent',
	displayName: 'Cursor Agent (CLI)',
	baseUrl: CURSOR_AGENT_BASE_URL,
	defaultModels: ['composer-2-fast'],
	requiresApiKey: false,
};

export class CursorAgentProvider extends Provider {
	override getApiKey(): string | undefined {
		const key = this.config.OPENAI_API_KEY;
		return key && key.length > 0 ? key : undefined;
	}

	override validateConfig(): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		const bin = getCursorAgentBinary();
		if (!isCursorAgentBinaryRunnable(bin)) {
			errors.push(
				`Cursor Agent CLI ("${bin}") not found or not working. Install: https://cursor.com/docs/cli/overview — then run \`agent login\` or set CURSOR_API_KEY / optional OPENAI_API_KEY in config.`
			);
		}
		return { valid: errors.length === 0, errors };
	}

	override async setup(): Promise<[string, string][]> {
		const { password, isCancel } = await import('@clack/prompts');
		const updates: [string, string][] = [];
		const apiKey = await password({
			message:
				'Optional Cursor API key for headless use (leave empty if you use `agent login` on this machine):',
		});
		if (isCancel(apiKey)) {
			throw new Error('Setup cancelled');
		}
		if (apiKey && (apiKey as string).trim().length > 0) {
			updates.push(['OPENAI_API_KEY', (apiKey as string).trim()]);
		}
		return updates;
	}
}
