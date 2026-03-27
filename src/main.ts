import { MarkdownView, Plugin, TFile } from 'obsidian';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { NavigationStack, HistoryEntry } from './navigation-stack';
import { shouldCreateNewEntry } from './selection-state';

export default class CursorHistoryPlugin extends Plugin {
	private navStack = new NavigationStack();
	private currentState: HistoryEntry | null = null;
	private isNavigating = false;

	async onload() {
		this.addCommand({
			id: 'go-back',
			name: 'Go back',
			callback: () => this.goBack(),
		});

		this.addCommand({
			id: 'go-forward',
			name: 'Go forward',
			callback: () => this.goForward(),
		});

		// Listen for file switches
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				if (this.isNavigating) return;
				this.recordCurrentPosition();
			})
		);

		// Listen for cursor changes within editors via CM6
		this.registerEditorExtension(
			EditorView.updateListener.of((update: ViewUpdate) => {
				if (this.isNavigating) return;
				if (!update.selectionSet) return;
				this.recordCurrentPosition();
			})
		);
	}

	private recordCurrentPosition(): void {
		const entry = this.getActiveEntry();
		if (!entry) return;

		if (shouldCreateNewEntry(this.currentState, entry)) {
			this.navStack.push(entry);
		} else {
			this.navStack.replaceCurrent(entry);
		}

		this.currentState = entry;
	}

	private getActiveEntry(): HistoryEntry | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return null;

		const editor = view.editor;
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');

		return {
			filePath: view.file.path,
			selection: {
				startLine: from.line,
				startCol: from.ch,
				endLine: to.line,
				endCol: to.ch,
			},
		};
	}

	private async goBack(): Promise<void> {
		// Before going back, make sure the current position is recorded
		const current = this.getActiveEntry();
		if (current && shouldCreateNewEntry(this.currentState, current)) {
			this.navStack.push(current);
			this.currentState = current;
		}

		const entry = this.navStack.goBack();
		if (entry) await this.navigateTo(entry);
	}

	private async goForward(): Promise<void> {
		const current = this.getActiveEntry();
		if (current && shouldCreateNewEntry(this.currentState, current)) {
			this.navStack.push(current);
			this.currentState = current;
		}

		const entry = this.navStack.goForward();
		if (entry) await this.navigateTo(entry);
	}

	private async navigateTo(entry: HistoryEntry): Promise<void> {
		this.isNavigating = true;

		try {
			const file = this.app.vault.getAbstractFileByPath(entry.filePath);
			if (!(file instanceof TFile)) return;

			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);

			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				const editor = view.editor;
				editor.setSelection(
					{ line: entry.selection.startLine, ch: entry.selection.startCol },
					{ line: entry.selection.endLine, ch: entry.selection.endCol }
				);
				editor.scrollIntoView(
					{
						from: { line: entry.selection.startLine, ch: entry.selection.startCol },
						to: { line: entry.selection.endLine, ch: entry.selection.endCol },
					},
					true
				);
			}

			this.currentState = entry;
		} finally {
			// Delay clearing the flag to let events from navigation settle
			setTimeout(() => {
				this.isNavigating = false;
			}, 100);
		}
	}
}
