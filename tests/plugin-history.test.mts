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

	it('queues repeated shortcuts and visits every history entry in order', async () => {
		// Arrange
		const {
			finishNextNavigation,
			getActiveFilePath,
			getPendingNavigationCount,
			openFile,
			runCommand,
			triggerLayoutReady,
		} = createTestContext({ deferNavigation: true });
		triggerLayoutReady();
		openFile('Projects/Aurora Launch.md');
		openFile('Reviews/Friday Review.md');
		openFile('Research/Interview Notes.md');

		// Act
		runCommand('go-back');
		runCommand('go-back');
		runCommand('go-back');

		// Assert
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), 'Reviews/Friday Review.md');
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), 'Projects/Aurora Launch.md');
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), '00 Start Here.md');

		runCommand('go-forward');
		runCommand('go-forward');
		runCommand('go-forward');

		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), 'Projects/Aurora Launch.md');
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), 'Reviews/Friday Review.md');
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), 'Research/Interview Notes.md');
	});

	it('keeps handling held shortcut repeats after the editor is replaced', async () => {
		// Arrange
		const {
			dispatchKeydown,
			finishNextNavigation,
			getActiveFilePath,
			getPendingNavigationCount,
			openFile,
			runCommand,
			triggerLayoutReady,
		} = createTestContext({ deferNavigation: true });
		triggerLayoutReady();
		openFile('Projects/Aurora Launch.md');
		openFile('Reviews/Friday Review.md');
		openFile('Research/Interview Notes.md');

		// Act
		runCommand('go-back');
		await finishNextNavigation();
		const firstBackRepeat = dispatchKeydown({
			ctrlKey: true,
			key: 'ArrowLeft',
			metaKey: true,
			repeat: true,
		});
		dispatchKeydown({
			ctrlKey: true,
			key: 'ArrowLeft',
			metaKey: true,
			repeat: true,
		});

		// Assert
		assert.deepEqual(firstBackRepeat, {
			defaultPrevented: true,
			immediatePropagationStopped: true,
		});
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), 'Projects/Aurora Launch.md');
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), '00 Start Here.md');

		runCommand('go-forward');
		await finishNextNavigation();
		dispatchKeydown({
			ctrlKey: true,
			key: 'ArrowRight',
			metaKey: true,
			repeat: true,
		});
		dispatchKeydown({
			ctrlKey: true,
			key: 'ArrowRight',
			metaKey: true,
			repeat: true,
		});
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), 'Reviews/Friday Review.md');
		assert.equal(getPendingNavigationCount(), 1);
		await finishNextNavigation();
		assert.equal(getActiveFilePath(), 'Research/Interview Notes.md');
	});

	it('restores editor focus after navigating to a history entry', async () => {
		// Arrange
		const {
			finishNextNavigation,
			isEditorFocused,
			openFile,
			runCommand,
			triggerLayoutReady,
		} = createTestContext({ deferNavigation: true });
		triggerLayoutReady();
		openFile('Projects/Aurora Launch.md');

		// Act
		runCommand('go-back');
		await finishNextNavigation();

		// Assert
		assert.equal(isEditorFocused(), true);
	});

	function createTestContext({ deferNavigation = false } = {}) {
		const eventCallbacks = new Map<string, Array<() => void>>();
		const domEventCallbacks = new Map<string, Array<(event: KeyboardEvent) => void>>();
		const layoutReadyCallbacks: Array<() => void> = [];
		const commands = new Map<string, { callback: () => void }>();
		const pendingNavigations: Array<{
			file: MockTFile;
			resolve: () => void;
		}> = [];
		let activeLine = 0;
		let editorFocused = true;

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

			registerDomEvent(
				_target: Window,
				eventName: string,
				callback: (event: KeyboardEvent) => void
			) {
				const callbacks = domEventCallbacks.get(eventName) ?? [];
				callbacks.push(callback);
				domEventCallbacks.set(eventName, callbacks);
			}

			registerEditorExtension() {}
		}

		const editor = {
			focus() {
				editorFocused = true;
			},
			getCursor() {
				return { line: activeLine, ch: 0 };
			},
			scrollIntoView() {},
			setSelection(from: { line: number }) {
				activeLine = from.line;
			},
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
						if (deferNavigation) {
							await new Promise<void>((resolve) => {
								pendingNavigations.push({ file, resolve });
							});
						}
						activeView.file = file;
						editorFocused = false;
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
					return undefined;
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
						Platform: { isMacOS: true },
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
			dispatchKeydown({
				ctrlKey = false,
				key,
				metaKey = false,
				repeat = false,
			}: {
				ctrlKey?: boolean;
				key: string;
				metaKey?: boolean;
				repeat?: boolean;
			}) {
				let defaultPrevented = false;
				let immediatePropagationStopped = false;
				const event = {
					altKey: false,
					ctrlKey,
					get defaultPrevented() {
						return defaultPrevented;
					},
					key,
					metaKey,
					preventDefault() {
						defaultPrevented = true;
					},
					repeat,
					shiftKey: false,
					stopImmediatePropagation() {
						immediatePropagationStopped = true;
					},
				} as KeyboardEvent;
				for (const callback of domEventCallbacks.get('keydown') ?? []) {
					callback(event);
				}
				return { defaultPrevented, immediatePropagationStopped };
			},
			async finishNextNavigation() {
				const pending = pendingNavigations.shift();
				assert.ok(pending, 'expected a pending navigation');
				pending.resolve();
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			},
			getActiveFilePath() {
				return activeView.file.path;
			},
			getPendingNavigationCount() {
				return pendingNavigations.length;
			},
			isEditorFocused() {
				return editorFocused;
			},
			openFile(filePath: string) {
				activeLine += 20;
				activeView.file = new MockTFile(filePath);
				for (const callback of eventCallbacks.get('file-open') ?? []) callback();
			},
			plugin,
			runCommand(commandId: string) {
				const command = commands.get(commandId);
				assert.ok(command, `expected command ${commandId}`);
				command.callback();
			},
			triggerLayoutReady() {
				for (const callback of layoutReadyCallbacks) callback();
			},
		};
	}
});
