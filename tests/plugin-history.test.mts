import * as assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

describe('Cursor History plugin lifecycle', () => {
	it('remembers the initial note and every file opened in the same leaf', () => {
		// Arrange
		const { openFile, plugin, triggerLayoutReady } = createTestContext();

		// Act
		triggerLayoutReady();
		openFile('Projects/Aurora Launch.md');
		openFile('Reviews/Friday Review.md');
		openFile('Research/Interview Notes.md');

		// Assert
		assert.deepEqual(
			[
				plugin.navStack.goBack()?.filePath ?? null,
				plugin.navStack.goBack()?.filePath ?? null,
				plugin.navStack.goBack()?.filePath ?? null,
				plugin.navStack.goBack()?.filePath ?? null,
			],
			[
				'Reviews/Friday Review.md',
				'Projects/Aurora Launch.md',
				'00 Start Here.md',
				null,
			]
		);
		assert.deepEqual(
			[
				plugin.navStack.goForward()?.filePath ?? null,
				plugin.navStack.goForward()?.filePath ?? null,
				plugin.navStack.goForward()?.filePath ?? null,
				plugin.navStack.goForward()?.filePath ?? null,
			],
			[
				'Projects/Aurora Launch.md',
				'Reviews/Friday Review.md',
				'Research/Interview Notes.md',
				null,
			]
		);
	});

	it('does not record file-open events caused by history navigation', () => {
		// Arrange
		const { openFile, plugin, triggerLayoutReady } = createTestContext();
		triggerLayoutReady();

		// Act
		plugin.isNavigating = true;
		openFile('Projects/Aurora Launch.md');
		plugin.isNavigating = false;

		// Assert
		assert.equal(plugin.navStack.goBack(), null);
	});

	function createTestContext() {
		const eventCallbacks = new Map<string, Array<() => void>>();
		const layoutReadyCallbacks: Array<() => void> = [];
		const commands = new Map<string, { callback: () => void }>();
		let activeLine = 0;

		class MockTFile {
			path: string;

			constructor(path: string) {
				this.path = path;
			}
		}

		class MockMarkdownView {}

		class MockPlugin {
			app: typeof app;

			constructor(appInstance: typeof app) {
				this.app = appInstance;
			}

			addCommand(command: { id: string; callback: () => void }) {
				commands.set(command.id, command);
			}

			registerEvent() {}

			registerEditorExtension() {}
		}

		const editor = {
			getCursor() {
				return { line: activeLine, ch: 0 };
			},
			scrollIntoView() {},
			setSelection() {},
		};
		const activeView = {
			editor,
			file: new MockTFile('00 Start Here.md'),
		};
		const workspace = {
			getActiveViewOfType() {
				return activeView;
			},
			getLeaf() {
				return {
					async openFile(file: MockTFile) {
						activeView.file = file;
					},
				};
			},
			on(eventName: string, callback: () => void) {
				const callbacks = eventCallbacks.get(eventName) ?? [];
				callbacks.push(callback);
				eventCallbacks.set(eventName, callbacks);
				return { eventName, callback };
			},
			onLayoutReady(callback: () => void) {
				layoutReadyCallbacks.push(callback);
			},
			updateOptions() {},
		};
		const app = {
			hotkeyManager: {
				getHotkeys() {
					return [];
				},
			},
			vault: {
				getAbstractFileByPath(filePath: string) {
					return new MockTFile(filePath);
				},
			},
			workspace,
		};
		const bundle = buildSync({
			bundle: true,
			entryPoints: [fileURLToPath(new URL('../src/main.ts', import.meta.url))],
			external: ['obsidian'],
			format: 'cjs',
			platform: 'node',
			target: 'node22',
			write: false,
		}).outputFiles[0].text;
		const module = { exports: {} as Record<string, unknown> };
		runInNewContext(bundle, {
			clearTimeout,
			console,
			module,
			exports: module.exports,
			require(moduleName: string) {
				if (moduleName === 'obsidian') {
					return {
						MarkdownView: MockMarkdownView,
						Plugin: MockPlugin,
						TFile: MockTFile,
					};
				}
				throw new Error(`Unexpected runtime import: ${moduleName}`);
			},
			setTimeout,
			window: { setTimeout },
		});
		const PluginClass = module.exports.default as new (
			appInstance: typeof app
		) => {
			isNavigating: boolean;
			navStack: {
				goBack(): { filePath: string } | null;
				goForward(): { filePath: string } | null;
			};
			onload(): void;
		};
		const plugin = new PluginClass(app);
		plugin.onload();

		return {
			openFile(filePath: string) {
				activeLine += 20;
				activeView.file = new MockTFile(filePath);
				for (const callback of eventCallbacks.get('file-open') ?? []) callback();
			},
			plugin,
			triggerLayoutReady() {
				for (const callback of layoutReadyCallbacks) callback();
			},
		};
	}
});
