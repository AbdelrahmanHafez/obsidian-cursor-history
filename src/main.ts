import { Plugin } from 'obsidian';

export default class CursorHistoryPlugin extends Plugin {
	async onload() {
		console.log('Cursor History plugin loaded');
	}

	onunload() {
		console.log('Cursor History plugin unloaded');
	}
}
