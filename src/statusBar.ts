import * as vscode from "vscode";
import { Account } from "./cswap";

/** Status bar item showing the active Claude account; click to swap. */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = "cswap.swap";
    this.item.show();
    this.showLoading();
  }

  showLoading(): void {
    this.item.text = "$(claude-logo) $(sync~spin)";
    this.item.tooltip = "Loading Claude accounts…";
  }

  showError(message: string): void {
    this.item.text = "$(claude-logo) $(error)";
    this.item.tooltip = `CSwap: ${message}\n\nClick to retry / swap.`;
  }

  update(accounts: Account[]): void {
    const active = accounts.find((a) => a.active);
    if (!active) {
      this.item.text = "$(claude-logo) No account";
      this.item.tooltip = accounts.length
        ? "No active account detected. Click to swap."
        : "No managed accounts. Click to add one.";
      return;
    }

    const label = shortEmail(active.email);
    this.item.text = `$(claude-logo) ${label}`;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Active Claude account**\n\n${active.email}\n\n`);
    if (active.org) {
      md.appendMarkdown(`${active.org}\n\n`);
    }
    if (active.usage.length) {
      md.appendMarkdown("---\n\n");
      for (const line of active.usage) {
        md.appendMarkdown(`- ${line}\n`);
      }
    }
    md.appendMarkdown(`\n\n_Click to swap (${accounts.length} accounts)._`);
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}

/** Trim a long email to keep the status bar compact. */
function shortEmail(email: string): string {
  if (email.length <= 22) {
    return email;
  }
  const [user, domain] = email.split("@");
  if (domain) {
    return `${user}@${domain.split(".")[0]}`;
  }
  return email.slice(0, 21) + "…";
}
