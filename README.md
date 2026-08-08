# Cursor History

<p align="center">
  <strong>Go back to the exact place you were.</strong><br>
  Move through exact cursor and selection positions, including several places inside one Obsidian note.
</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/cursor-history">
    <img src="docs/assets/install-in-obsidian.svg" alt="View and install Cursor History in Obsidian" height="48">
  </a>
</p>

| One note, several positions | Back to an earlier selection in the same note |
| --- | --- |
| ![Latest Cursor History view with a selected sentence in Aurora Launch](docs/assets/cursor-history-latest.png) | ![Cursor History Back shortcut shown over an earlier selection in Aurora Launch](docs/assets/cursor-history-back.png) |

## See it in action

![Cursor History demo showing back and forward navigation with visible keyboard shortcuts](docs/assets/cursor-history-demo.gif)

The demo moves through several saved positions inside long notes, then crosses between notes. The live keystroke display appears as each navigation happens.

<p align="center">
  <a href="docs/assets/cursor-history-demo.mp4">Watch the full-quality recording</a>
</p>

## What it does

- Reopens the note, restores the exact cursor or selection, and brings it into view
- Navigates backward and forward through recent cursor and selection locations
- Groups ordinary movements within 10 lines into one stop, while deliberate jumps create new stops
- Creates a new stop when you change files
- Keeps up to 200 positions for the current Obsidian session

Going back and then navigating somewhere new clears the forward history, matching browser behavior.

## Shortcuts

| Action | Editing mode default |
| --- | --- |
| Go back | `Ctrl` + `Cmd` + `Left` |
| Go forward | `Ctrl` + `Cmd` + `Right` |

Change either binding in **Settings > Hotkeys** by searching for “Cursor History.”

## Install

Open [Cursor History in the Obsidian Community directory](https://community.obsidian.md/plugins/cursor-history), then press **Add to Obsidian**.

For a manual installation, download `main.js` and `manifest.json` from the [latest release](https://github.com/AbdelrahmanHafez/obsidian-cursor-history/releases/latest), then place them in `<vault>/.obsidian/plugins/cursor-history/`.

## License

[MIT](LICENSE)
