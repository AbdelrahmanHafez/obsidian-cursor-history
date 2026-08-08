import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { EditorState } from '@codemirror/state';
import { isJumpTransaction } from '../src/selection-events.ts';

test('does not treat ordinary cursor selection as a jump', () => {
	// Arrange
	const state = EditorState.create({ doc: 'Hello' });
	const transaction = state.update({ selection: { anchor: 3 }, userEvent: 'select.pointer' });

	// Act
	const isJump = isJumpTransaction(transaction);

	// Assert
	assert.equal(isJump, false);
});

test('treats an explicitly annotated navigation as a jump', () => {
	// Arrange
	const state = EditorState.create({ doc: 'Hello' });
	const transaction = state.update({ selection: { anchor: 3 }, userEvent: 'navigation' });

	// Act
	const isJump = isJumpTransaction(transaction);

	// Assert
	assert.equal(isJump, true);
});

test('does not treat text input as a jump', () => {
	// Arrange
	const state = EditorState.create({ doc: 'Hello' });
	const transaction = state.update({ changes: { from: 5, insert: '!' }, userEvent: 'input.type' });

	// Act
	const isJump = isJumpTransaction(transaction);

	// Assert
	assert.equal(isJump, false);
});

test('does not treat unannotated transactions as jumps', () => {
	// Arrange
	const state = EditorState.create({ doc: 'Hello' });
	const transaction = state.update({ selection: { anchor: 3 } });

	// Act
	const isJump = isJumpTransaction(transaction);

	// Assert
	assert.equal(isJump, false);
});
