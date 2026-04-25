import { testSuite, expect } from 'manten';
import {
	getCursorAgentMaxDiffChars,
	parseAgentModelsList,
	stripAnsiSequences,
	truncateCommitSubjectForLength,
} from '../../../src/utils/cursor-agent.js';

export default testSuite(({ describe }) => {
	describe('Cursor Agent model list parsing', ({ test }) => {
		test('stripAnsiSequences removes common escape codes', () => {
			const raw = '\x1b[2K\x1b[Gcomposer-2-fast - Composer 2 Fast';
			expect(stripAnsiSequences(raw)).toBe('composer-2-fast - Composer 2 Fast');
		});

		test('parseAgentModelsList extracts model ids', () => {
			const stdout = [
				'\x1b[2K\x1b[GAvailable models',
				'',
				'composer-2-fast - Composer 2 Fast  (default)',
				'gpt-5.2 - GPT-5.2',
			].join('\n');
			const ids = parseAgentModelsList(stdout);
			expect(ids).toEqual(['composer-2-fast', 'gpt-5.2']);
		});

		test('getCursorAgentMaxDiffChars default', () => {
			const prev = process.env.AICOMMITS_CURSOR_MAX_DIFF_CHARS;
			delete process.env.AICOMMITS_CURSOR_MAX_DIFF_CHARS;
			expect(getCursorAgentMaxDiffChars()).toBe(16_000);
			if (prev !== undefined) process.env.AICOMMITS_CURSOR_MAX_DIFF_CHARS = prev;
		});

		test('truncateCommitSubjectForLength respects max and word boundary', () => {
			const long = 'feat: add something very long ' + 'x'.repeat(100);
			const out = truncateCommitSubjectForLength(long, 40);
			expect(out.length).toBeLessThanOrEqual(40);
		});
	});
});
