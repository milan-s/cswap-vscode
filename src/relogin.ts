/**
 * Re-login orchestration for an account whose stored refresh token is dead.
 *
 * Kept free of `vscode` imports so the flow can be unit-tested with fakes.
 * The only manual step is the browser sign-in done inside `login()`.
 */

/** Minimal account shape the flow needs. */
export interface ReloginAccount {
  number: number;
  email: string;
}

export type LoginOutcome =
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "failed"; exitCode: number };

/** Side effects of the flow, injected so tests can fake them. */
export interface ReloginOps {
  /** Save the active account's live credentials into its slot (`cswap add`). */
  snapshotActive(): Promise<void>;
  /** Ask whether to go on when the snapshot failed. */
  confirmContinueWithoutSnapshot(message: string): Promise<boolean>;
  /** Run `claude auth login` for `email` and wait for it to finish. */
  login(email: string): Promise<LoginOutcome>;
  /** Email of the live Claude Code login, or undefined if logged out. */
  loggedInEmail(): Promise<string | undefined>;
  /** Store the fresh live login into its existing slot (`cswap add`). */
  captureLogin(): Promise<void>;
  /** `cswap switch <n>`. */
  switchTo(accountNumber: number): Promise<void>;
}

export interface ReloginOptions {
  /** Switch back to the previously active account afterwards (default true). */
  restore?: boolean;
}

export type ReloginResult =
  /** `activeChanged`: the live login now differs from before (reload needed). */
  | { kind: "ok"; activeChanged: boolean; restoreError?: string }
  /** Login was cancelled; the live credentials were never touched. */
  | { kind: "cancelled" }
  /** The user declined to continue after a failed snapshot. */
  | { kind: "aborted"; reason: string }
  | { kind: "loginFailed"; exitCode: number }
  /** Signed in as a different account; the original login was put back if possible. */
  | { kind: "wrongAccount"; got?: string; restoreError?: string }
  | { kind: "saveFailed"; message: string; restoreError?: string };

/**
 * Re-login `target` with only a browser confirmation from the user:
 *
 *   1. snapshot the active account so its latest refresh token isn't lost
 *   2. `claude auth login --email <target>` (user confirms in the browser)
 *   3. verify the live login really is `target`
 *   4. `cswap add` — refreshes the target's slot in place
 *   5. switch back to the previously active account (unless `restore: false`)
 */
export async function relogin(
  target: ReloginAccount,
  active: ReloginAccount | undefined,
  ops: ReloginOps,
  options: ReloginOptions = {},
): Promise<ReloginResult> {
  const restore = options.restore ?? true;
  const switchBackTo =
    restore && active && active.number !== target.number ? active : undefined;

  if (active) {
    try {
      await ops.snapshotActive();
    } catch (err) {
      const message = errMessage(err);
      const proceed = await ops.confirmContinueWithoutSnapshot(message);
      if (!proceed) {
        return { kind: "aborted", reason: message };
      }
    }
  }

  const outcome = await ops.login(target.email);
  if (outcome.kind === "cancelled") {
    return { kind: "cancelled" };
  }
  if (outcome.kind === "failed") {
    return { kind: "loginFailed", exitCode: outcome.exitCode };
  }

  const got = await ops.loggedInEmail().catch(() => undefined);
  if (!got || !sameEmail(got, target.email)) {
    // The live login now belongs to someone else: put the original back.
    const restoreError = active ? await tryRestore(ops, active) : undefined;
    return { kind: "wrongAccount", got, restoreError };
  }

  try {
    await ops.captureLogin();
  } catch (err) {
    const restoreError = switchBackTo
      ? await tryRestore(ops, switchBackTo)
      : undefined;
    return { kind: "saveFailed", message: errMessage(err), restoreError };
  }

  if (switchBackTo) {
    const restoreError = await tryRestore(ops, switchBackTo);
    // A failed switch-back leaves the target live, so the active account changed.
    return { kind: "ok", activeChanged: restoreError !== undefined, restoreError };
  }
  return { kind: "ok", activeChanged: true };
}

/** Whether cswap's usage lines flag the account's refresh token as dead. */
export function needsRelogin(usage: string[]): boolean {
  return usage.some((line) => /^re-login needed\b/i.test(line.trim()));
}

async function tryRestore(
  ops: ReloginOps,
  account: ReloginAccount,
): Promise<string | undefined> {
  try {
    await ops.switchTo(account.number);
    return undefined;
  } catch (err) {
    return errMessage(err);
  }
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
