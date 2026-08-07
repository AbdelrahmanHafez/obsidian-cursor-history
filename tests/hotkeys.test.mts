import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveHotkeys } from '../src/hotkeys.ts';

const fallback = [{ modifiers: ['Ctrl', 'Mod'], key: 'ArrowLeft' }];

test('uses the fallback when no custom hotkey exists', () => {
	// Arrange
	const manager = { getHotkeys: () => undefined };

	// Act
	const hotkeys = resolveHotkeys(manager, 'cursor-history:go-back', fallback);

	// Assert
	assert.equal(hotkeys, fallback);
});

test('uses the configured hotkey when one exists', () => {
	// Arrange
	const configured = [{ modifiers: ['Mod'], key: 'ArrowLeft' }];
	const manager = { getHotkeys: () => configured };

	// Act
	const hotkeys = resolveHotkeys(manager, 'cursor-history:go-back', fallback);

	// Assert
	assert.equal(hotkeys, configured);
});

test('respects an explicitly cleared hotkey', () => {
	// Arrange
	const manager = { getHotkeys: () => [] };

	// Act
	const hotkeys = resolveHotkeys(manager, 'cursor-history:go-back', fallback);

	// Assert
	assert.deepEqual(hotkeys, []);
});
