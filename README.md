# CSwap — Claude Account Switcher for VSCode

A thin VSCode front-end over [`cswap`](https://pypi.org/project/claude-swap/) (claude-swap),
the multi-account switcher for Claude Code. Add, list, remove, and — **mainly** — quickly
**swap** between Claude accounts without leaving the editor.

It shells out to your existing `cswap` install; it never stores credentials itself.

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
npm run compile      # or: npm run watch
```

Then press **F5** in VSCode ("Run Extension") to launch an Extension Development Host
with the plugin loaded.

### Install into your editor

```bash
npx @vscode/vsce package          # produces cswap-vscode-x.y.z.vsix
code --uninstall-extension MadCowTM.cswap-vscode
code --install-extension cswap-vscode-x.y.z.vsix
```

## How it works

The extension never parses or stores tokens. It calls:

- `cswap --list` and parses the text output (ANSI-stripped) into the account list / usage.
- `cswap --switch-to <n>` to swap.
- `cswap --add-account`, `cswap --add-token -` (token via stdin), `cswap --remove-account <n>`
  for management.

## License

MIT
