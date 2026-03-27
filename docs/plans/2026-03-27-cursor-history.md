# Cursor History Plugin - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** An Obsidian plugin that tracks cursor position history across files (like VS Code's navigateBack/navigateForward) and lets users navigate back and forward through that history.

**Architecture:** A `NavigationStack` manages an array of `HistoryEntry` objects (file path + selection) with a current index pointer. The plugin listens for active-leaf changes (file switches) and CM6 selection changes (cursor movement within a file). A 10-line threshold determines when cursor movement constitutes a new history entry vs updating the current one. Commands "Cursor: Go Back" and "Cursor: Go Forward" navigate the stack, opening files and restoring selections.

**Tech Stack:** Obsidian Plugin API, CodeMirror 6 (EditorView update listener), TypeScript, esbuild

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `manifest.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `src/main.ts` (empty plugin shell)

**Step 1: Create project files**

`package.json`:
```json
{
	"name": "obsidian-cursor-history",
	"version": "1.0.0",
	"description": "Navigate back and forward through cursor position history across files",
	"main": "main.js",
	"scripts": {
		"dev": "node esbuild.config.mjs",
		"build": "node esbuild.config.mjs production"
	},
	"keywords": ["obsidian", "plugin", "cursor", "history", "navigation"],
	"license": "MIT",
	"devDependencies": {
		"@types/node": "^22.0.0",
		"esbuild": "^0.24.0",
		"obsidian": "latest",
		"typescript": "~5.6.0"
	}
}
```

`tsconfig.json`:
```json
{
	"compilerOptions": {
		"baseUrl": ".",
		"inlineSourceMap": true,
		"inlineSources": true,
		"module": "ESNext",
		"target": "ES6",
		"allowJs": true,
		"noImplicitAny": true,
		"moduleResolution": "node",
		"importHelpers": true,
		"isolatedModules": true,
		"strictNullChecks": true,
		"lib": ["DOM", "ES5", "ES6", "ES7"]
	},
	"include": ["src/**/*.ts"]
}
```

`esbuild.config.mjs`:
```javascript
import esbuild from 'esbuild';

const prod = process.argv[2] === 'production';

esbuild.build({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
	],
	format: 'cjs',
	target: 'es2018',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
}).catch(() => process.exit(1));
```

`manifest.json`:
```json
{
	"id": "cursor-history",
	"name": "Cursor History",
	"version": "1.0.0",
	"minAppVersion": "1.0.0",
	"description": "Navigate back and forward through cursor position history across files, like VS Code.",
	"author": "Hafez",
	"authorUrl": "https://github.com/AbdelrahmanHafez",
	"isDesktopOnly": false
}
```

`.gitignore`:
```
node_modules/
main.js
data.json
```

`LICENSE`: MIT license, Copyright (c) 2026 Abdelrahman Hafez

`src/main.ts`:
```typescript
import { Plugin } from 'obsidian';

export default class CursorHistoryPlugin extends Plugin {
	async onload() {
		console.log('Cursor History plugin loaded');
	}

	onunload() {
		console.log('Cursor History plugin unloaded');
	}
}
```

**Step 2: Install dependencies and verify build**

Run: `npm install && npm run build`
Expected: Build succeeds, `main.js` is created.

**Step 3: Deploy to vault and verify plugin loads**

Run: `mkdir -p "/Users/hafez/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Vault/.obsidian/plugins/cursor-history" && cp main.js manifest.json "/Users/hafez/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Vault/.obsidian/plugins/cursor-history/"`

Enable the plugin in Obsidian. Check the console for "Cursor History plugin loaded".

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: initial project scaffolding"
```

---

### Task 2: NavigationStack Data Structure

**Files:**
- Create: `src/navigation-stack.ts`

This is the core data structure, independent of Obsidian APIs.

**Step 1: Create the NavigationStack**

`src/navigation-stack.ts`:
```typescript
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
```

**Step 2: Commit**

```bash
git add src/navigation-stack.ts
git commit -m "feat: add NavigationStack data structure"
```

---

### Task 3: Selection Comparison Logic

**Files:**
- Create: `src/selection-state.ts`

This implements the VS Code heuristic: same line = IDENTICAL, within 10 lines = SIMILAR, 10+ lines = DIFFERENT.

**Step 1: Create the selection comparison module**

`src/selection-state.ts`:
```typescript
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
```

**Step 2: Commit**

```bash
git add src/selection-state.ts
git commit -m "feat: add selection comparison with 10-line threshold"
```

---

### Task 4: Wire Up the Plugin - Listen for Cursor Changes

**Files:**
- Modify: `src/main.ts`

Listen for two events:
1. Active leaf change (file switch) - always creates a new entry
2. CM6 selection changes (cursor movement within file) - uses the 10-line threshold

**Step 1: Implement the full plugin**

`src/main.ts`:
```typescript
import { MarkdownView, Plugin } from 'obsidian';
import { EditorSelection } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { NavigationStack, HistoryEntry, Selection } from './navigation-stack';
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
		const entry = this.navStack.goForward();
		if (entry) await this.navigateTo(entry);
	}

	private async navigateTo(entry: HistoryEntry): Promise<void> {
		this.isNavigating = true;

		try {
			const file = this.app.vault.getAbstractFileByPath(entry.filePath);
			if (!file) {
				this.isNavigating = false;
				return;
			}

			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file as any);

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
```

**Step 2: Build and deploy**

Run: `npm run build && cp main.js manifest.json "/Users/hafez/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Vault/.obsidian/plugins/cursor-history/"`

**Step 3: Manual test in Obsidian**

1. Reload Obsidian (Cmd+R)
2. Open Settings > Hotkeys, search "Cursor History", verify "Go back" and "Go forward" appear
3. Open a file, move cursor to different locations 10+ lines apart
4. Switch to a different file
5. Trigger "Go back" from command palette - should return to previous file at previous cursor position
6. Trigger "Go forward" - should go to where you were

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire up cursor tracking and back/forward navigation"
```

---

### Task 5: README and Release Setup

**Files:**
- Create: `README.md`
- Create: `.github/workflows/release.yml`
- Create: `versions.json`
- Create: `styles.css`

**Step 1: Create README.md**

```markdown
# Cursor History

An [Obsidian](https://obsidian.md) plugin that tracks cursor position history across files and lets you navigate back and forward, like VS Code's `workbench.action.navigateBack` / `workbench.action.navigateForward`.

## Features

- Tracks cursor positions across files with a 10-line threshold (small movements update the current entry, large jumps create new ones)
- Navigate back and forward through your cursor history
- Browser-style stack: going back then moving somewhere new clears the forward history
- Session-based, max 50 entries

## Installation

### From Obsidian Community Plugins

1. Open **Settings > Community plugins**
2. Search for **Cursor History**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/AbdelrahmanHafez/obsidian-cursor-history/releases/latest)
2. Create a folder `cursor-history` inside your vault's `.obsidian/plugins/` directory
3. Place the downloaded files inside that folder
4. Reload Obsidian and enable the plugin in **Settings > Community plugins**

## Configuration

Open **Settings > Hotkeys** and search for "Cursor History" to bind keys to:

| Command | Suggested Binding |
|---------|-------------------|
| Cursor History: Go back | Ctrl+Cmd+← |
| Cursor History: Go forward | Ctrl+Cmd+→ |

## How It Works

The plugin uses VS Code's position-based heuristic (not timer-based polling):

- **Same line**: updates the current history entry (no new stop)
- **Within 10 lines**: updates the current entry
- **10+ lines apart**: creates a new history entry
- **Different file**: always creates a new entry
- **Going back then navigating**: clears forward history (browser-style)

## License

[MIT](LICENSE)
```

**Step 2: Create release workflow**

`.github/workflows/release.yml`:
```yaml
name: Release

on:
  push:
    tags:
      - '*'

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run build
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            main.js
            manifest.json
```

`versions.json`:
```json
{
	"1.0.0": "1.0.0"
}
```

`styles.css`:
```css
/* Cursor History plugin styles */
```

**Step 3: Commit**

```bash
git add README.md .github/workflows/release.yml versions.json styles.css
git commit -m "docs: add README, release workflow, and metadata"
```

---

### Task 6: Create GitHub Repo and Release

**Step 1: Create repo and push**

```bash
git add -A
gh repo create obsidian-cursor-history --public --source=. --push --description "Obsidian plugin to navigate back and forward through cursor position history across files"
```

**Step 2: Tag and release**

```bash
git tag 1.0.0
git push origin 1.0.0
```

Wait for the GitHub Action to complete, then verify the release has `main.js` and `manifest.json`.

**Step 3: Enable in vault**

Add `"cursor-history"` to the vault's `community-plugins.json` and reload Obsidian.
