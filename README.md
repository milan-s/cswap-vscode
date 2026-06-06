# CSwap — Claude Account Switcher for VSCode

A thin VSCode front-end over [`cswap`](https://pypi.org/project/claude-swap/) (claude-swap),
the multi-account switcher for Claude Code. Add, list, remove, and — **mainly** — quickly
**swap** between Claude accounts without leaving the editor.

It shells out to your existing `cswap` install; it never stores credentials itself.

## Features

- **Status bar item** showing the active account. Click it to open a QuickPick and swap instantly.
- **Sidebar panel** ("Claude Accounts") listing every managed account with org and usage %.
  Inline buttons to swap or remove; the title bar has add / refresh.
- **Swap** via QuickPick or by clicking an inactive account in the sidebar. After a swap you
  get a **Reload Window** prompt so Claude Code picks up the new auth.
- **Add accounts** two ways:
  - *Add Current Account* — captures the account you're currently logged into (`cswap --add-account`).
  - *Add from OAuth Token* — paste a `sk-ant-oat01-…` setup-token (`cswap --add-token`, fed via stdin
    so it never appears in your process list).
- **Remove** an account with a confirmation dialog.
- Optional polling (`cswap.refreshIntervalSeconds`) to keep usage figures fresh.

## Requirements

- `cswap` (claude-swap) installed and working. Verify with `cswap --list`.
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

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `cswap.path` | `""` | Absolute path to the `cswap` binary. Empty = auto-detect. |
| `cswap.refreshIntervalSeconds` | `0` | Auto-refresh interval. `0` disables polling. |

## Develop / run locally

```bash
npm install
npm run compile      # or: npm run watch
```

Then press **F5** in VSCode ("Run Extension") to launch an Extension Development Host
with the plugin loaded.

### Install into your editor

```bash
npm install -g @vscode/vsce
vsce package          # produces cswap-vscode-0.1.0.vsix
code --install-extension cswap-vscode-0.1.0.vsix
```

## How it works

The extension never parses or stores tokens. It calls:

- `cswap --list` and parses the text output (ANSI-stripped) into the account list / usage.
- `cswap --switch-to <n>` to swap.
- `cswap --add-account`, `cswap --add-token -` (token via stdin), `cswap --remove-account <n>`
  for management.

## License

MIT
