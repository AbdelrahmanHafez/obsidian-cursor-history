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

Default keybindings are set up automatically on first install:

| Command | Default Binding |
|---------|-----------------|
| Cursor History: Go back | Ctrl+Cmd+← |
| Cursor History: Go forward | Ctrl+Cmd+→ |

To change them, open **Settings > Hotkeys** and search for "Cursor History".

## How It Works

The plugin uses VS Code's position-based heuristic (not timer-based polling):

- **Same line**: updates the current history entry (no new stop)
- **Within 10 lines**: updates the current entry
- **10+ lines apart**: creates a new history entry
- **Different file**: always creates a new entry
- **Going back then navigating**: clears forward history (browser-style)

## License

[MIT](LICENSE)
