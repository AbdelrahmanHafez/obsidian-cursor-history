# Cursor History

<p align="center">
  <strong>Go back to the exact place you were.</strong><br>
  Return to exact cursor positions across Obsidian notes, like Back and Forward in a browser.
</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/cursor-history">
    <img src="docs/assets/install-in-obsidian.svg" alt="View and install Cursor History in Obsidian" height="48">
  </a>
</p>

| Three notes later | Back to the exact selection |
| --- | --- |
| ![Cursor History at the latest cursor position](docs/assets/cursor-history-latest.png) | ![Cursor History navigating back to an earlier selection](docs/assets/cursor-history-back.png) |

## See it in action

![Cursor History demo showing back and forward navigation with visible keyboard shortcuts](docs/assets/cursor-history-demo.gif)

<p align="center">
  <a href="docs/assets/cursor-history-demo.mp4">Watch the full-quality recording</a>
</p>

## What it does

- Reopens the note, restores the exact cursor or selection, and brings it into view
- Navigates backward and forward through recent editing locations
- Groups ordinary movements within 10 lines into one history stop
- Creates a new stop for file changes and explicit cursor jumps
- Keeps up to 50 positions for the current Obsidian session

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
