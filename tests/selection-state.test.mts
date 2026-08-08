import * as assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import type { HistoryEntry } from '../src/navigation-stack.ts';

describe('selection history grouping', () => {
	const shouldCreateNewEntry = loadSelectionState();

	it('coalesces consecutive arrow-key movement', () => {
		// Arrange
		let current = createTestContext({ line: 0 });
		const decisions: boolean[] = [];

		// Act
		for (let line = 1; line <= 30; line++) {
			const incoming = createTestContext({ line });
			decisions.push(shouldCreateNewEntry(current, incoming));
			current = incoming;
		}

		// Assert
		assert.deepEqual(decisions, Array.from({ length: 30 }, () => false));
	});

	it('records a large cursor move or an explicit nearby jump', () => {
		// Arrange
		const current = createTestContext({ line: 5 });

		// Act
		const decisions = {
			largeMove: shouldCreateNewEntry(current, createTestContext({ line: 15 })),
			nearbyJump: shouldCreateNewEntry(current, createTestContext({ line: 6 }), true),
		};

		// Assert
		assert.deepEqual(decisions, { largeMove: true, nearbyJump: true });
	});

	function createTestContext({ line }: { line: number }): HistoryEntry {
		return {
			filePath: 'Projects/Aurora Launch.md',
			selection: {
				startLine: line,
				startCol: 0,
				endLine: line,
				endCol: 0,
			},
		};
	}

	function loadSelectionState() {
		const bundle = buildSync({
			bundle: true,
			entryPoints: [fileURLToPath(new URL('../src/selection-state.ts', import.meta.url))],
			format: 'cjs',
			platform: 'node',
			target: 'node22',
			write: false,
		}).outputFiles[0].text;
		const module = { exports: {} as Record<string, unknown> };
		runInNewContext(bundle, { module, exports: module.exports });
		return module.exports.shouldCreateNewEntry as (
			current: HistoryEntry | null,
			incoming: HistoryEntry,
			isJump?: boolean
		) => boolean;
	}
});
