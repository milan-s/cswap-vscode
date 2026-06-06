import * as vscode from "vscode";
import { Account } from "./cswap";

/** Tree item representing one managed Claude account. */
export class AccountItem extends vscode.TreeItem {
  constructor(readonly account: Account) {
    super(account.email, vscode.TreeItemCollapsibleState.None);

    this.contextValue = "cswapAccount";
    this.description = describe(account);
    this.tooltip = buildTooltip(account);

    this.iconPath = account.active
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

function describe(a: Account): string {
  const parts: string[] = [];
  if (a.active) {
    parts.push("● active");
  }
  if (a.org) {
    parts.push(a.org);
  }
  // Surface the first usage figure inline (e.g. "$$: 21% ...").
  if (a.usage.length > 0) {
    parts.push(a.usage[0]);
  }
  return parts.join("  ·  ");
}

function buildTooltip(a: Account): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${a.email}**${a.active ? "  _(active)_" : ""}\n\n`);
  if (a.org) {
    md.appendMarkdown(`Org: ${a.org}\n\n`);
  }
  md.appendMarkdown(`Slot: ${a.number}\n\n`);
  if (a.usage.length > 0) {
    md.appendMarkdown("---\n\n");
    for (const line of a.usage) {
      md.appendMarkdown(`- ${line}\n`);
    }
  }
  return md;
}

export class AccountsProvider implements vscode.TreeDataProvider<AccountItem> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private accounts: Account[] = [];

  setAccounts(accounts: Account[]): void {
    this.accounts = accounts;
    this._onDidChange.fire();
  }

  getTreeItem(element: AccountItem): vscode.TreeItem {
    return element;
  }

  getChildren(): AccountItem[] {
    return this.accounts.map((a) => new AccountItem(a));
  }
}
