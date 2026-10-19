import * as vscode from "vscode";
import { Account } from "./cswap";

type AnyItem = AccountItem | UsageItem;

/** Tree item representing one usage detail line under an account. */
export class UsageItem extends vscode.TreeItem {
  constructor(line: string) {
    super(line, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "cswapUsage";
    this.iconPath = new vscode.ThemeIcon("pulse");
  }
}

/** Tree item representing one managed Claude account. */
export class AccountItem extends vscode.TreeItem {
  constructor(
    readonly account: Account,
    expandUsage: boolean,
  ) {
    const hasUsage = account.usage.length > 0;
    super(
      account.email,
      expandUsage && hasUsage
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    this.contextValue = account.needsRelogin ? "cswapAccountRelogin" : "cswapAccount";
    this.description = describe(account, expandUsage);
    this.tooltip = buildTooltip(account);

    this.iconPath = account.needsRelogin
      ? new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"))
      : account.active
        ? new vscode.ThemeIcon(
            "pass-filled",
            new vscode.ThemeColor("charts.green"),
          )
        : new vscode.ThemeIcon("account");

    // Clicking the row swaps to that account.
    if (!account.active) {
      this.command = {
        command: "cswap.switchToItem",
        title: "Switch to this account",
        arguments: [this],
      };
    }
  }
}

function describe(a: Account, expandUsage: boolean): string {
  const parts: string[] = [];
  if (a.active) {
    parts.push("● active");
  }
  if (a.needsRelogin) {
    parts.push("re-login needed");
  }
  if (a.org) {
    parts.push(a.org);
  }
  // When usage is expanded into children, omit it from the inline description.
  if (!expandUsage && a.usage.length > 0) {
    parts.push(a.usage[0]);
  }
  return parts.join("  ·  ");
}

function buildTooltip(a: Account): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${a.email}**${a.active ? "  _(active)_" : ""}\n\n`);
  if (a.org) {
    md.appendMarkdown(`Org: ${a.org}\n\n`);
  }
  md.appendMarkdown(`Slot: ${a.number}\n\n`);
  if (a.needsRelogin) {
    md.appendMarkdown("$(warning) Refresh token expired — use **Re-login** to sign in again.\n\n");
  }
  if (a.usage.length > 0) {
    md.appendMarkdown("---\n\n");
    for (const line of a.usage) {
      md.appendMarkdown(`- ${line}\n`);
    }
  }
  return md;
}

export class AccountsProvider implements vscode.TreeDataProvider<AnyItem> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private accounts: Account[] = [];
  private _expandUsage = true;

  get expandUsage(): boolean {
    return this._expandUsage;
  }

  setAccounts(accounts: Account[]): void {
    this.accounts = accounts;
    this._onDidChange.fire();
  }

  /** Toggle expanded usage details. Returns the new state. */
  toggleUsage(): boolean {
    this._expandUsage = !this._expandUsage;
    this._onDidChange.fire();
    return this._expandUsage;
  }

  getTreeItem(element: AnyItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AnyItem): AnyItem[] {
    if (!element) {
      return this.accounts.map((a) => new AccountItem(a, this._expandUsage));
    }
    if (element instanceof AccountItem && this._expandUsage) {
      return element.account.usage.map((line) => new UsageItem(line));
    }
    return [];
  }
}
