import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NavigationStack } from '../src/navigation-stack.ts';

describe('NavigationStack', () => {
	it('keeps the latest 200 cursor locations', () => {
		// Arrange
		const stack = createTestContext();

		// Act
		for (let line = 0; line < 201; line++) {
			stack.push({
				filePath: 'Projects/Aurora Launch.md',
				selection: {
					startLine: line,
					startCol: 0,
					endLine: line,
					endCol: 0,
				},
			});
		}

		// Assert
		const rememberedLines: number[] = [];
		for (let entry = stack.goBack(); entry; entry = stack.goBack()) {
			rememberedLines.push(entry.selection.startLine);
		}
		assert.equal(rememberedLines.length, 199);
		assert.equal(rememberedLines.at(-1), 1);
	});

	function createTestContext() {
		return new NavigationStack();
	}
});
