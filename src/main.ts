import { MarkdownView, Plugin, TFile } from 'obsidian';
import { keymap } from '@codemirror/view';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { NavigationStack, HistoryEntry } from './navigation-stack';
import { shouldCreateNewEntry } from './selection-state';

// --- Obsidian type augmentation for undocumented APIs ---

interface ObsidianHotkey {
	modifiers: string[];
	key: string;
}

declare module 'obsidian' {
	interface App {
		hotkeyManager: {
			getHotkeys(id: string): ObsidianHotkey[] | undefined;
			getDefaultHotkeys(id: string): ObsidianHotkey[];
			load(): Promise<void>;
		};
	}
}

interface PluginData {
	hotkeyDefaultsApplied?: boolean;
}

const DESIRED_HOTKEYS: Record<string, ObsidianHotkey> = {
	'cursor-history:go-back': { modifiers: ['Ctrl', 'Mod'], key: 'ArrowLeft' },
	'cursor-history:go-forward': { modifiers: ['Ctrl', 'Mod'], key: 'ArrowRight' },
};

// --- Plugin ---

export default class CursorHistoryPlugin extends Plugin {
	private navStack = new NavigationStack();
	private currentState: HistoryEntry | null = null;
	private isNavigating = false;
	private hotkeyExtension: Extension[] = [];
	private pluginData: PluginData = {};

	async onload() {
		this.pluginData = (await this.loadData()) || {};

		this.addCommand({
			id: 'go-back',
			name: 'Go back',
			callback: () => void this.goBack(),
		});

		this.addCommand({
			id: 'go-forward',
			name: 'Go forward',
			callback: () => void this.goForward(),
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

				const isJump = update.transactions.some(tr => {
					const event = tr.annotation(EditorView.userEvent);
					return event != null && event !== 'input' && event !== 'delete'
						&& event !== 'undo' && event !== 'redo';
				});

				this.recordCurrentPosition(isJump);
			})
		);

		// CM6 keymaps for key-repeat support
		this.registerEditorExtension(this.hotkeyExtension);
		this.app.workspace.onLayoutReady(async () => {
			await this.applyDefaultHotkeys();
			this.buildKeymap();
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.buildKeymap())
		);
	}

	private async applyDefaultHotkeys() {
		if (this.pluginData.hotkeyDefaultsApplied) return;

		const configPath = `${this.app.vault.configDir}/hotkeys.json`;
		let hotkeys: Record<string, ObsidianHotkey[]> = {};

		try {
			hotkeys = JSON.parse(await this.app.vault.adapter.read(configPath));
		} catch {
			// File doesn't exist or is invalid
		}

		let changed = false;
		for (const [cmdId, hk] of Object.entries(DESIRED_HOTKEYS)) {
			if (hotkeys[cmdId]) continue;
			hotkeys[cmdId] = [hk];
			changed = true;
		}

		if (changed) {
			await this.app.vault.adapter.write(configPath, JSON.stringify(hotkeys, null, '  '));
			if (typeof this.app.hotkeyManager?.load === 'function') {
				await this.app.hotkeyManager.load();
			}
		}

		this.pluginData.hotkeyDefaultsApplied = true;
		await this.saveData(this.pluginData);
	}

	private buildKeymap(): void {
		const backKeys = this.getCommandHotkeys('cursor-history:go-back');
		const forwardKeys = this.getCommandHotkeys('cursor-history:go-forward');

		const bindings: Array<{ key: string; run: () => boolean }> = [];

		for (const hk of backKeys) {
			bindings.push({
				key: [...hk.modifiers, hk.key].join('-'),
				run: () => { void this.goBack(); return true; },
			});
		}

		for (const hk of forwardKeys) {
			bindings.push({
				key: [...hk.modifiers, hk.key].join('-'),
				run: () => { void this.goForward(); return true; },
			});
		}

		this.hotkeyExtension.length = 0;
		if (bindings.length > 0) {
			this.hotkeyExtension.push(keymap.of(bindings));
		}
		this.app.workspace.updateOptions();
	}

	private getCommandHotkeys(commandId: string): ObsidianHotkey[] {
		const hm = this.app.hotkeyManager;
		if (!hm) return [];

		const custom = hm.getHotkeys(commandId);
		if (custom !== undefined) return custom;
		return hm.getDefaultHotkeys(commandId) || [];
	}

	private recordCurrentPosition(isJump = false): void {
		const entry = this.getActiveEntry();
		if (!entry) return;

		if (shouldCreateNewEntry(this.currentState, entry, isJump)) {
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

