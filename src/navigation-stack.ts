export interface Selection {
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
}

export interface HistoryEntry {
	filePath: string;
	selection: Selection;
}

const MAX_STACK_SIZE = 50;

export class NavigationStack {
	private stack: HistoryEntry[] = [];
	private index = -1;

	get canGoBack(): boolean {
		return this.index > 0;
	}

	get canGoForward(): boolean {
		return this.index < this.stack.length - 1;
	}

	get currentEntry(): HistoryEntry | null {
		if (this.index < 0 || this.index >= this.stack.length) return null;
		return this.stack[this.index];
	}

	push(entry: HistoryEntry): void {
		// Discard forward history
		if (this.index < this.stack.length - 1) {
			this.stack = this.stack.slice(0, this.index + 1);
		}

		this.stack.push(entry);
		this.index = this.stack.length - 1;

		// Enforce max size
		if (this.stack.length > MAX_STACK_SIZE) {
			this.stack.shift();
			this.index--;
		}
	}

	replaceCurrent(entry: HistoryEntry): void {
		if (this.index >= 0 && this.index < this.stack.length) {
			this.stack[this.index] = entry;
		}
	}

	goBack(): HistoryEntry | null {
		if (!this.canGoBack) return null;
		this.index--;
		return this.stack[this.index];
	}

	goForward(): HistoryEntry | null {
		if (!this.canGoForward) return null;
		this.index++;
		return this.stack[this.index];
	}
}
