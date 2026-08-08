import { MarkdownView, Platform, Plugin, TFile } from 'obsidian';
import { keymap } from '@codemirror/view';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { NavigationStack, HistoryEntry } from './navigation-stack';
import { shouldCreateNewEntry } from './selection-state';
import { ObsidianHotkey, resolveHotkeys } from './hotkeys';
import { isJumpTransaction } from './selection-events';

// --- Obsidian type augmentation for undocumented APIs ---

declare module 'obsidian' {
	interface App {
		hotkeyManager: {
			getHotkeys(id: string): ObsidianHotkey[] | undefined;
		};
	}
}

const DEFAULT_HOTKEYS: Record<string, ObsidianHotkey[]> = {
	'cursor-history:go-back': [{ modifiers: ['Ctrl', 'Mod'], key: 'ArrowLeft' }],
	'cursor-history:go-forward': [{ modifiers: ['Ctrl', 'Mod'], key: 'ArrowRight' }],
};

type NavigationDirection = 'back' | 'forward';

// --- Plugin ---

export default class CursorHistoryPlugin extends Plugin {
	private navStack = new NavigationStack();
	private currentState: HistoryEntry | null = null;
	private isNavigating = false;
	private hotkeyExtension: Extension[] = [];
	private navigationQueue: NavigationDirection[] = [];
	private isProcessingNavigation = false;
	private navigationSequence = 0;
	private backHotkeys = DEFAULT_HOTKEYS['cursor-history:go-back'];
	private forwardHotkeys = DEFAULT_HOTKEYS['cursor-history:go-forward'];

	onload() {
		this.addCommand({
			id: 'go-back',
			name: 'Go back',
			callback: () => this.queueNavigation('back'),
		});

		this.addCommand({
			id: 'go-forward',
			name: 'Go forward',
			callback: () => this.queueNavigation('forward'),
		});

		this.registerDomEvent(
			window,
			'keydown',
			(event) => this.handleRepeatedHotkey(event),
			{ capture: true }
		);

		// Listen for pane switches
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				if (this.isNavigating) return;
				this.recordCurrentPosition();
			})
		);

		// Opening another file in the same pane does not change the active leaf
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				if (this.isNavigating) return;
				this.recordCurrentPosition();
			})
		);

		// Listen for cursor changes within editors via CM6
		this.registerEditorExtension(
			EditorView.updateListener.of((update: ViewUpdate) => {
				if (this.isNavigating) return;
				if (!update.selectionSet) return;

				const isJump = update.transactions.some(isJumpTransaction);

				this.recordCurrentPosition(isJump);
			})
		);

		// CM6 keymaps for key-repeat support
		this.registerEditorExtension(this.hotkeyExtension);
		this.app.workspace.onLayoutReady(() => {
			this.buildKeymap();
			this.recordCurrentPosition();
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.buildKeymap())
		);
	}

	private buildKeymap(): void {
		this.backHotkeys = resolveHotkeys(
			this.app.hotkeyManager,
			'cursor-history:go-back',
			DEFAULT_HOTKEYS['cursor-history:go-back']
		);
		this.forwardHotkeys = resolveHotkeys(
			this.app.hotkeyManager,
			'cursor-history:go-forward',
			DEFAULT_HOTKEYS['cursor-history:go-forward']
		);

		const bindings: Array<{ key: string; run: () => boolean }> = [];

		for (const hk of this.backHotkeys) {
			bindings.push({
				key: [...hk.modifiers, hk.key].join('-'),
				run: () => { this.queueNavigation('back'); return true; },
			});
		}

		for (const hk of this.forwardHotkeys) {
			bindings.push({
				key: [...hk.modifiers, hk.key].join('-'),
				run: () => { this.queueNavigation('forward'); return true; },
			});
		}

		this.hotkeyExtension.length = 0;
		if (bindings.length > 0) {
			this.hotkeyExtension.push(keymap.of(bindings));
		}
		this.app.workspace.updateOptions();
	}

	private handleRepeatedHotkey(event: KeyboardEvent): void {
		if (!event.repeat) return;

		let direction: NavigationDirection | null = null;
		if (this.backHotkeys.some((hotkey) => matchesHotkey(event, hotkey))) {
			direction = 'back';
		} else if (this.forwardHotkeys.some((hotkey) => matchesHotkey(event, hotkey))) {
			direction = 'forward';
		}
		if (!direction) return;

		event.preventDefault();
		event.stopImmediatePropagation();
		this.queueNavigation(direction);
	}

	private queueNavigation(direction: NavigationDirection): void {
		this.navigationQueue.push(direction);
		void this.processNavigationQueue();
	}

	private async processNavigationQueue(): Promise<void> {
		if (this.isProcessingNavigation) return;
		this.isProcessingNavigation = true;

		try {
			let direction = this.navigationQueue.shift();
			while (direction) {
				try {
					if (direction === 'back') {
						await this.goBack();
					} else {
						await this.goForward();
					}
				} catch (error) {
					console.error('Cursor History navigation failed', error);
				}
				direction = this.navigationQueue.shift();
			}
		} finally {
			this.isProcessingNavigation = false;
		}
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
		const navigationSequence = ++this.navigationSequence;
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
				editor.focus();
			}

			this.currentState = entry;
		} finally {
			window.setTimeout(() => {
				if (navigationSequence === this.navigationSequence) {
					this.isNavigating = false;
				}
			}, 100);
		}
	}
}

function matchesHotkey(event: KeyboardEvent, hotkey: ObsidianHotkey): boolean {
	const modifiers = new Set(hotkey.modifiers);
	const modIsControl = modifiers.has('Mod') && !Platform.isMacOS;
	const modIsMeta = modifiers.has('Mod') && Platform.isMacOS;

	return event.key.toLowerCase() === hotkey.key.toLowerCase()
		&& event.altKey === modifiers.has('Alt')
		&& event.ctrlKey === (modifiers.has('Ctrl') || modIsControl)
		&& event.metaKey === (modifiers.has('Meta') || modIsMeta)
		&& event.shiftKey === modifiers.has('Shift');
}
