import { Transaction } from '@codemirror/state';

const NON_JUMP_EVENTS = ['input', 'delete', 'undo', 'redo'];

export function isJumpTransaction(transaction: Transaction): boolean {
	const event = transaction.annotation(Transaction.userEvent);
	return event !== undefined
		&& !NON_JUMP_EVENTS.some((eventType) => transaction.isUserEvent(eventType));
}
