import { MarkdownView, Plugin, TFile } from 'obsidian';
import { keymap } from '@codemirror/view';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { NavigationStack, HistoryEntry } from './navigation-stack';
import { shouldCreateNewEntry } from './selection-state';

interface ObsidianHotkey {
	modifiers: string[];
	key: string;
}

export default class CursorHistoryPlugin extends Plugin {
	private navStack = new NavigationStack();
	private currentState: HistoryEntry | null = null;
	private isNavigating = false;
	private hotkeyExtension: Extension[] = [];

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

		// CM6 keymaps for key-repeat support
		this.registerEditorExtension(this.hotkeyExtension);
		this.app.workspace.onLayoutReady(() => this.buildKeymap());
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.buildKeymap())
		);
	}

	private buildKeymap(): void {
		const backKeys = this.getCommandHotkeys('cursor-history:go-back');
		const forwardKeys = this.getCommandHotkeys('cursor-history:go-forward');

		const bindings: Array<{ key: string; run: () => boolean }> = [];

		for (const hk of backKeys) {
			bindings.push({
				key: [...hk.modifiers, hk.key].join('-'),
				run: () => { this.goBack(); return true; },
			});
		}

		for (const hk of forwardKeys) {
			bindings.push({
				key: [...hk.modifiers, hk.key].join('-'),
				run: () => { this.goForward(); return true; },
			});
		}

		this.hotkeyExtension.length = 0;
		if (bindings.length > 0) {
			this.hotkeyExtension.push(keymap.of(bindings));
		}
		this.app.workspace.updateOptions();
	}

	private getCommandHotkeys(commandId: string): ObsidianHotkey[] {
		const hm = (this.app as any).hotkeyManager;
		if (!hm) return [];

		const custom = hm.getHotkeys(commandId);
		if (custom !== undefined) return custom;
		return hm.getDefaultHotkeys(commandId) || [];
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
			setTimeout(() => {
				this.isNavigating = false;
			}, 100);
		}
	}
}
