# CSwap — Claude Account Switcher for VS Code

Switch between multiple real Claude Code accounts — Pro, Max, Enterprise — directly from VS Code.
Built on [`cswap`](https://pypi.org/project/claude-swap/) (claude-swap), which swaps the actual
OAuth credentials Claude Code uses, so **both the CLI and any in-editor terminals pick up the new
account instantly**.

It shells out to your existing `cswap` install; it never stores or parses credentials itself.

## How account switching actually works

Claude Code authenticates with an OAuth token stored securely on your machine — Keychain on macOS,
credential files on Linux and Windows. Switching accounts means replacing that token with one
belonging to a different account.

When you swap:

1. `cswap` writes the new account's OAuth token to the platform credential store
2. This extension reloads the VS Code window (and optionally closes Claude terminals first)
3. Claude Code — both the CLI and any terminals running inside VS Code — re-reads the new
   credentials from the store

This is a full account switch, not a model or API key change. It works for any account type
(Pro, Max, Enterprise) because they all authenticate the same way. Credentials are never
touched by this extension directly; `cswap` handles all storage using platform-native secure
storage on each OS.

## Features

- **Status bar item** showing the active account. Click it to open a QuickPick and swap instantly.
- **Sidebar panel** ("Claude Accounts") listing every managed account with org and full usage
  details expanded below each account row by default. A toggle button in the panel title bar
  collapses them back to a single compact line if preferred.
- **Swap** via QuickPick or by clicking an inactive account in the sidebar. After a swap you
  get a **Reload Window** prompt so Claude Code picks up the new auth — or enable
  `cswap.autoReloadWindow` to reload automatically without prompting.
- **Close Claude terminals automatically** on account switch with `cswap.closeClaudeTerminals`,
  so stale Claude Code sessions don't linger after swapping.
- **Add accounts** two ways:
  - *Add Current Account* — captures the account you're currently logged into (`cswap --add-account`).
  - *Add from OAuth Token* — paste a `sk-ant-oat01-…` setup-token (`cswap --add-token`, fed via
    stdin so it never appears in your process list).
- **Remove** an account with a confirmation dialog.
- Optional polling (`cswap.refreshIntervalSeconds`) to keep usage figures fresh.

## Requirements

- `cswap` (claude-swap) installed and working. Install it with:
  ```bash
  pip install claude-swap
  ```
  Verify with `cswap --list`.
- The extension auto-detects `cswap` on your `PATH` and in `~/.local/bin`, `/usr/local/bin`,
  `/opt/homebrew/bin`. If it lives elsewhere, set **`cswap.path`** to the absolute path.

## Commands

| Command | Description |
| --- | --- |
| `CSwap: Swap Claude Account` | Open the QuickPick swapper (also the status-bar click action) |
| `CSwap: Refresh Accounts` | Re-read the account list |
| `CSwap: Add Current Account` | Add the currently logged-in account |
| `CSwap: Add Account from OAuth Token` | Register a raw setup-token |
| `CSwap: Switch to This Account` | (sidebar) swap to the selected account |
| `CSwap: Remove This Account` | (sidebar) remove the selected account |
| `CSwap: Show Usage Details` | (sidebar title bar) expand usage rows under each account |
| `CSwap: Hide Usage Details` | (sidebar title bar) collapse usage rows back to one line |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `cswap.path` | `""` | Absolute path to the `cswap` binary. Empty = auto-detect. |
| `cswap.refreshIntervalSeconds` | `0` | Auto-refresh interval in seconds. `0` disables polling. |
| `cswap.autoReloadWindow` | `false` | Reload the VS Code window automatically after switching accounts, without prompting. |
| `cswap.closeClaudeTerminals` | `false` | Close any open terminals whose name contains "claude" before reloading after an account switch. |

## Develop / run locally

```bash
npm install
npm run watch        # TypeScript auto-compiles on save
```

Then press **F5** in VS Code ("Run Extension") to open an Extension Development Host with the
plugin loaded live. Save a file → TypeScript recompiles → `Ctrl+Shift+F5` in the dev window
restarts the extension host.

To test the packaged extension as a real user would see it:

```bash
npm run build:install   # compile → package → uninstall old → install fresh → reload VS Code
```

## How it works internally

The extension shells out to `cswap` for all account operations and never reads tokens directly:

- `cswap --list` — parsed (ANSI-stripped) to build the account list and usage figures
- `cswap --switch-to <n>` — performs the credential swap
- `cswap --add-account` — captures the currently logged-in account
- `cswap --add-token -` — registers a setup-token read from stdin
- `cswap --remove-account <n>` — removes an account

## License

MIT — see [LICENSE](LICENSE).

`cswap` (claude-swap) is a separate project licensed under MIT.
