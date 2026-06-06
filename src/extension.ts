import * as vscode from "vscode";
import {
  Account,
  CswapError,
  addCurrentAccount,
  addToken,
  listAccounts,
  removeAccount,
  switchTo,
} from "./cswap";
import { AccountItem, AccountsProvider } from "./accountsProvider";
import { StatusBar } from "./statusBar";

let provider: AccountsProvider;
let statusBar: StatusBar;
let refreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  provider = new AccountsProvider();
  statusBar = new StatusBar();

  const treeView = vscode.window.createTreeView("cswapAccounts", {
    treeDataProvider: provider,
  });

  context.subscriptions.push(
    treeView,
    statusBar,
    vscode.commands.registerCommand("cswap.refresh", () => refresh()),
    vscode.commands.registerCommand("cswap.swap", () => swapCommand()),
    vscode.commands.registerCommand("cswap.addCurrent", () => addCurrentCommand()),
    vscode.commands.registerCommand("cswap.addToken", () => addTokenCommand()),
    vscode.commands.registerCommand("cswap.switchToItem", (item?: AccountItem) =>
      switchToItemCommand(item),
    ),
    vscode.commands.registerCommand("cswap.removeItem", (item?: AccountItem) =>
      removeItemCommand(item),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cswap")) {
        setupAutoRefresh(context);
        refresh();
      }
    }),
  );

  setupAutoRefresh(context);
  void refresh();
}

export function deactivate(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
}

/** (Re)configure the optional polling timer from settings. */
function setupAutoRefresh(context: vscode.ExtensionContext): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  const seconds = vscode.workspace
    .getConfiguration("cswap")
    .get<number>("refreshIntervalSeconds", 0);
  if (seconds && seconds > 0) {
    refreshTimer = setInterval(() => void refresh(), seconds * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(refreshTimer!) });
  }
}

/** Reload the account list into the tree and status bar. */
async function refresh(): Promise<Account[]> {
  statusBar.showLoading();
  try {
    const accounts = await listAccounts();
    provider.setAccounts(accounts);
    statusBar.update(accounts);
    return accounts;
  } catch (err) {
    const message = err instanceof CswapError ? err.message : String(err);
    statusBar.showError(message);
    provider.setAccounts([]);
    return [];
  }
}

/** QuickPick swap — the headline feature. */
async function swapCommand(): Promise<void> {
  let accounts: Account[];
  try {
    accounts = await listAccounts();
  } catch (err) {
    void vscode.window.showErrorMessage(errText(err));
    return;
  }

  if (accounts.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      "No managed Claude accounts. Add one?",
      "Add Current Account",
      "Add from Token",
    );
    if (choice === "Add Current Account") {
      await addCurrentCommand();
    } else if (choice === "Add from Token") {
      await addTokenCommand();
    }
    return;
  }

  const items = accounts.map((a) => ({
    label: `${a.active ? "$(pass-filled) " : "$(account) "}${a.email}`,
    description: [a.org, a.usage[0]].filter(Boolean).join("  ·  "),
    detail: a.usage.slice(1).join("   "),
    account: a,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Swap Claude Account",
    placeHolder: "Select an account to switch to",
    matchOnDescription: true,
  });
  if (!picked) {
    return;
  }
  if (picked.account.active) {
    void vscode.window.showInformationMessage(
      `${picked.account.email} is already active.`,
    );
    return;
  }
  await doSwitch(picked.account);
}

async function switchToItemCommand(item?: AccountItem): Promise<void> {
  if (!item) {
    return swapCommand();
  }
  if (item.account.active) {
    void vscode.window.showInformationMessage(
      `${item.account.email} is already active.`,
    );
    return;
  }
  await doSwitch(item.account);
}

/** Perform the switch and offer to reload the window. */
async function doSwitch(account: Account): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Switching to ${account.email}…`,
      },
      () => switchTo(account.number),
    );
  } catch (err) {
    void vscode.window.showErrorMessage(errText(err));
    return;
  }

  await refresh();

  const choice = await vscode.window.showInformationMessage(
    `Switched to ${account.email}. Reload the window for Claude Code to use the new account.`,
    "Reload Window",
  );
  if (choice === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

async function addCurrentCommand(): Promise<void> {
  try {
    const out = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Adding current Claude account…",
      },
      () => addCurrentAccount(),
    );
    void vscode.window.showInformationMessage(firstLine(out) || "Account added.");
  } catch (err) {
    void vscode.window.showErrorMessage(errText(err));
  }
  await refresh();
}

async function addTokenCommand(): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: "Add Account from OAuth Token",
    prompt: "Paste a Claude OAuth setup-token (sk-ant-oat01-…)",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) =>
      v.trim().startsWith("sk-ant-oat01-")
        ? undefined
        : "Expected a token starting with sk-ant-oat01-",
  });
  if (!token) {
    return;
  }

  const email = await vscode.window.showInputBox({
    title: "Account Email (optional)",
    prompt: "Email label for this account. Leave blank to use the cswap default.",
    ignoreFocusOut: true,
  });
  if (email === undefined) {
    return; // user pressed Escape
  }

  try {
    const out = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Registering token…",
      },
      () => addToken(token, email.trim() || undefined),
    );
    void vscode.window.showInformationMessage(firstLine(out) || "Account added.");
  } catch (err) {
    void vscode.window.showErrorMessage(errText(err));
  }
  await refresh();
}

async function removeItemCommand(item?: AccountItem): Promise<void> {
  if (!item) {
    return;
  }
  const a = item.account;
  const confirm = await vscode.window.showWarningMessage(
    `Permanently remove Account-${a.number} (${a.email})?`,
    { modal: true },
    "Remove",
  );
  if (confirm !== "Remove") {
    return;
  }
  try {
    const out = await removeAccount(a.number);
    void vscode.window.showInformationMessage(firstLine(out) || "Account removed.");
  } catch (err) {
    void vscode.window.showErrorMessage(errText(err));
  }
  await refresh();
}

function errText(err: unknown): string {
  const msg = err instanceof CswapError ? err.message : String(err);
  return `CSwap: ${msg}`;
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
}
