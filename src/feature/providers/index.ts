import { Provider, type ProviderDef } from './base.js';
import type { ValidConfig } from '../../utils/config-types.js';
import { providers } from './providers-data.js';
import { CursorAgentProvider } from './cursoragent.js';

export { Provider } from './base.js';
export type { ProviderDef } from './base.js';
export { providers };

export function getProvider(config: ValidConfig): Provider | null {
	const providerName = config.provider;
	const pDef = providers.find((p) => p.name === providerName);
	if (!pDef) return null;
	if (providerName === 'cursoragent') {
		return new CursorAgentProvider(pDef, config);
	}
	return new Provider(pDef, config);
}

export function getAvailableProviders(): { value: string; label: string }[] {
	return providers.map((p) => ({
		value: p.name,
		label: p.displayName,
	}));
}

export function getProviderBaseUrl(providerName: string): string {
	const provider = providers.find((p) => p.name === providerName);
	return provider?.baseUrl || '';
}

export function getProviderDef(providerName: string): ProviderDef | undefined {
	return providers.find((p) => p.name === providerName);
}
