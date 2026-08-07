export interface ObsidianHotkey {
	modifiers: string[];
	key: string;
}

interface HotkeyManager {
	getHotkeys(id: string): ObsidianHotkey[] | undefined;
}

export function resolveHotkeys(
	manager: HotkeyManager | undefined,
	commandId: string,
	fallback: ObsidianHotkey[]
): ObsidianHotkey[] {
	return manager?.getHotkeys(commandId) ?? fallback;
}
