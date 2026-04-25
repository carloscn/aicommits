import { testSuite } from 'manten';

export default testSuite(({ describe }) => {
	describe('Cursor Agent', ({ runTestSuite }) => {
		runTestSuite(import('./models-parse.js'));
	});
});
