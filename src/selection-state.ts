import { Selection, HistoryEntry } from './navigation-stack';

const LINE_THRESHOLD = 10;

export enum CompareResult {
	IDENTICAL,
	SIMILAR,
	DIFFERENT,
}

export function compareSelections(a: Selection, b: Selection): CompareResult {
	const lineA = Math.min(a.startLine, a.endLine);
	const lineB = Math.min(b.startLine, b.endLine);

	if (lineA === lineB) return CompareResult.IDENTICAL;
	if (Math.abs(lineA - lineB) < LINE_THRESHOLD) return CompareResult.SIMILAR;
	return CompareResult.DIFFERENT;
}

export function shouldCreateNewEntry(
	current: HistoryEntry | null,
	incoming: HistoryEntry
): boolean {
	if (!current) return true;
	if (current.filePath !== incoming.filePath) return true;
	return compareSelections(current.selection, incoming.selection) === CompareResult.DIFFERENT;
}
