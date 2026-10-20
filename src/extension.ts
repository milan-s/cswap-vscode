import { execFile } from "child_process";
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
import { authStatusEmail, runLoginInTerminal } from "./claude";
import { ReloginOptions, ReloginResult, relogin } from "./relogin";
import { formatStale } from "./staleness";
import { StatusBar } from "./statusBar";

let provider: AccountsProvider;
let statusBar: StatusBar;
let refreshTimer: NodeJS.Timeout | undefined;
let loginStorageDir: string;
let reloginRunning = false;
/** Accounts already announced as needing re-login, so we nag once per session. */
const reloginNotified = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  provider = new AccountsProvider();
  statusBar = new StatusBar();
  loginStorageDir = vscode.Uri.joinPath(context.globalStorageUri, "login").fsPath;

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
    vscode.commands.registerCommand("cswap.relogin", () => reloginPickCommand()),
    vscode.commands.registerCommand("cswap.reloginItem", (item?: AccountItem) =>
      item ? reloginCommand(item.account) : reloginPickCommand(),
    ),
    vscode.commands.registerCommand("cswap.expandUsage", () => {
      const expanded = provider.toggleUsage();
      void vscode.commands.executeCommand("setContext", "cswap.usageExpanded", expanded);
    }),
    vscode.commands.registerCommand("cswap.collapseUsage", () => {
      const expanded = provider.toggleUsage();
      void vscode.commands.executeCommand("setContext", "cswap.usageExpanded", expanded);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cswap")) {
        setupAutoRefresh(context);
        refresh();
      }
    }),
  );

  void vscode.commands.executeCommand("setContext", "cswap.usageExpanded", true);

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
    notifyReloginNeeded(accounts);
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
    detail: [...a.usage.slice(1), a.stale && `$(history) ${formatStale(a.stale, Date.now())}`]
      .filter(Boolean)
      .join("   "),
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
  if (account.needsRelogin) {
    const choice = await vscode.window.showWarningMessage(
      `${account.email} needs a re-login before switching — its refresh token has expired.`,
      "Re-login and Switch",
      "Switch Anyway",
    );
    if (choice === "Re-login and Switch") {
      // Stay on the account afterwards instead of switching back.
      await reloginCommand(account, { restore: false });
      return;
    }
    if (choice !== "Switch Anyway") {
      return;
    }
  }

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
  await afterLoginChanged(`Switched to ${account.email}.`);
}

/** Close Claude terminals and/or reload so Claude Code picks up the new login. */
async function afterLoginChanged(summary: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("cswap");
  const autoReload = cfg.get<boolean>("autoReloadWindow", false);
  const closeTerminals = cfg.get<boolean>("closeClaudeTerminals", false);

  if (closeTerminals) {
    disposeClaudeTerminals();
  }

  if (autoReload) {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `${summary} Reload the window for Claude Code to use the new account.`,
    "Reload Window",
  );
  if (choice === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

function disposeClaudeTerminals(): void {
  for (const terminal of vscode.window.terminals) {
    if (/claude/i.test(terminal.name)) {
      terminal.dispose();
    }
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

/** Announce accounts whose refresh token died, once per account per session. */
function notifyReloginNeeded(accounts: Account[]): void {
  for (const a of accounts) {
    if (!a.needsRelogin) {
      reloginNotified.delete(a.email);
      continue;
    }
    if (reloginRunning || reloginNotified.has(a.email)) {
      continue;
    }
    reloginNotified.add(a.email);
    void vscode.window
      .showWarningMessage(
        `Claude account ${a.email} needs a re-login — its refresh token has expired.`,
        "Re-login",
      )
      .then((choice) => {
        if (choice === "Re-login") {
          void reloginCommand(a);
        }
      });
  }
}

async function reloginPickCommand(): Promise<void> {
  let accounts: Account[];
  try {
    accounts = await listAccounts();
  } catch (err) {
    void vscode.window.showErrorMessage(errText(err));
    return;
  }
  if (accounts.length === 0) {
    void vscode.window.showInformationMessage("No managed Claude accounts.");
    return;
  }

  const items = [...accounts]
    .sort((a, b) => Number(b.needsRelogin) - Number(a.needsRelogin))
    .map((a) => ({
      label: `${a.needsRelogin ? "$(warning) " : "$(account) "}${a.email}`,
      description: [a.needsRelogin ? "re-login needed" : "", a.active ? "active" : "", a.org]
        .filter(Boolean)
        .join("  ·  "),
      account: a,
    }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Re-login Claude Account",
    placeHolder: "Select the account to sign in again",
  });
  if (picked) {
    await reloginCommand(picked.account);
  }
}

/**
 * Re-login an account via `claude auth login`, automating everything except
 * the browser approval: snapshot the active login, sign in, verify, save with
 * `cswap add`, and switch back (unless `options.restore` is false).
 */
async function reloginCommand(target: Account, options: ReloginOptions = {}): Promise<void> {
  if (process.platform === "win32") {
    void vscode.window.showErrorMessage("CSwap: Browser re-login is not supported on Windows yet.");
    return;
  }
  if (reloginRunning) {
    void vscode.window.showInformationMessage("A Claude re-login is already in progress.");
    return;
  }

  const start = await vscode.window.showInformationMessage(
    `Re-login ${target.email}?`,
    {
      modal: true,
      detail:
        "A terminal will run `claude auth login`. No browser opens on its own — you'll get a " +
        "sign-in link to open in the browser profile where this account is signed in to Claude. " +
        "Everything else (saving, verifying, switching back) is automatic.",
    },
    "Start Re-login",
  );
  if (start !== "Start Re-login") {
    return;
  }

  reloginRunning = true;
  let active: Account | undefined;
  let result: ReloginResult;
  try {
    try {
      active = (await listAccounts()).find((a) => a.active);
    } catch (err) {
      void vscode.window.showErrorMessage(errText(err));
      return;
    }

    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Re-login ${target.email}`,
        cancellable: true,
      },
      (progress, token) =>
        relogin(
          target,
          active,
          {
            snapshotActive: async () => {
              progress.report({ message: `saving the current login (${active?.email})…` });
              await addCurrentAccount();
            },
            confirmContinueWithoutSnapshot: async (message) =>
              (await vscode.window.showWarningMessage(
                `Couldn't save the current login (${active?.email}) first: ${message}`,
                {
                  modal: true,
                  detail: "If you continue, that account may need a re-login later too.",
                },
                "Continue",
              )) === "Continue",
            login: (email) => {
              progress.report({ message: "waiting for browser sign-in…" });
              return runLoginInTerminal(
                email,
                loginStorageDir,
                (url) => void offerLoginUrl(email, url),
                token,
              );
            },
            loggedInEmail: () => authStatusEmail(),
            captureLogin: async () => {
              progress.report({ message: "saving the new login…" });
              await addCurrentAccount();
            },
            switchTo: async (n) => {
              progress.report({ message: "switching back…" });
              await switchTo(n);
            },
          },
          options,
        ),
    );

  } finally {
    reloginRunning = false;
  }

  // Report outside the lock: its notifications resolve only when dismissed.
  const accounts = await refresh();
  await reportRelogin(target, active, result, accounts);
}

/** Hand the captured sign-in URL to the user instead of opening a browser. */
async function offerLoginUrl(email: string, url: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Sign-in link for ${email} is ready.`,
    {
      modal: true,
      detail:
        "Open it in the browser profile where this account is signed in to Claude and approve. " +
        "The login completes on its own — the link is also printed in the CSwap Login terminal.",
    },
    "Copy Link",
    "Open in Default Browser",
  );
  if (choice === "Copy Link") {
    await vscode.env.clipboard.writeText(url);
    void vscode.window.showInformationMessage(
      "Sign-in link copied — paste it into the right browser profile.",
    );
  } else if (choice === "Open in Default Browser") {
    // vscode.env.openExternal re-encodes the query string; hand it over verbatim.
    execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], () => undefined);
  }
}

async function reportRelogin(
  target: Account,
  active: Account | undefined,
  result: ReloginResult,
  accounts: Account[],
): Promise<void> {
  switch (result.kind) {
    case "ok": {
      if (result.restoreError) {
        void vscode.window.showWarningMessage(
          `CSwap: Re-logged in ${target.email}, but switching back to ${active?.email} failed: ` +
            `${result.restoreError}. ${target.email} is active now.`,
        );
      }
      if (result.activeChanged) {
        await afterLoginChanged(`Re-logged in ${target.email}.`);
        return;
      }
      const choice = await vscode.window.showInformationMessage(
        `Re-logged in ${target.email}. ${active?.email} is still the active account.`,
        "Switch to It",
      );
      const fresh = accounts.find((a) => a.number === target.number);
      if (choice === "Switch to It" && fresh) {
        await doSwitch(fresh);
      }
      return;
    }
    case "cancelled":
      void vscode.window.showInformationMessage("Re-login cancelled — nothing was changed.");
      return;
    case "aborted":
      return;
    case "loginFailed":
      void vscode.window.showErrorMessage(
        `CSwap: claude auth login exited with code ${result.exitCode} — see the CSwap Login terminal.`,
      );
      return;
    case "wrongAccount": {
      const restored = !active
        ? ""
        : result.restoreError
          ? ` Restoring ${active.email} failed: ${result.restoreError}`
          : ` ${active.email} was restored.`;
      void vscode.window.showErrorMessage(
        `CSwap: Signed in as ${result.got ?? "nobody"}, not ${target.email} — the login was not saved.` +
          `${restored} Retry in the browser profile for ${target.email}.`,
      );
      return;
    }
    case "saveFailed": {
      const restored = result.restoreError
        ? ` Switching back failed too: ${result.restoreError}`
        : "";
      void vscode.window.showErrorMessage(
        `CSwap: Signed in as ${target.email}, but cswap couldn't save it: ${result.message}.${restored}`,
      );
      return;
    }
  }
}

function errText(err: unknown): string {
  const msg = err instanceof CswapError ? err.message : String(err);
  return `CSwap: ${msg}`;
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
}
