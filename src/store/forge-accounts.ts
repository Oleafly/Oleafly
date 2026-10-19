import { create } from "zustand";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import {
  forgeAccountsList,
  forgeSetCaFile,
  forgeSignInToken,
  forgeSignOut,
  forgeValidate,
  onForgeAccountsChanged,
  type ForgeAccount,
  type ForgeKind,
} from "@/lib/tauri";

// Git hosting accounts shown across the app. Loaded lazily, the first time
// Source Control, the import UI or Settings needs them, and reloaded when
// another window (or the backend) changes them. Tokens never reach this
// store: the backend keeps them and hands back accounts only.

export type ForgeCheckState = "checking" | "ok" | "signed_out" | "unreachable";

interface ForgeAccountsState {
  status: "idle" | "loading" | "ready" | "error";
  accounts: ForgeAccount[];
  /** The last check of each account, by base URL. */
  checks: Record<string, ForgeCheckState>;
  error: string | null;
  /** Load once; concurrent callers share one request. */
  ensureLoaded: () => Promise<ForgeAccount[]>;
  reload: () => Promise<ForgeAccount[]>;
  signInWithToken: (input: {
    base: string;
    kind: ForgeKind;
    token: string;
    caFile?: string | null;
  }) => Promise<ForgeAccount>;
  /** Record an account a browser sign-in just added. */
  accountSignedIn: (account: ForgeAccount) => void;
  signOut: (base: string) => Promise<void>;
  setCaFile: (base: string, caFile: string | null) => Promise<ForgeAccount>;
  /** Check every account with its server, in parallel. */
  validateAll: () => Promise<void>;
}

function upsert(accounts: readonly ForgeAccount[], account: ForgeAccount): ForgeAccount[] {
  const index = accounts.findIndex((existing) => existing.base === account.base);
  if (index < 0) return [...accounts, account];
  const next = [...accounts];
  next[index] = account;
  return next;
}

function keepChecks(
  checks: Record<string, ForgeCheckState>,
  accounts: readonly ForgeAccount[],
): Record<string, ForgeCheckState> {
  const kept: Record<string, ForgeCheckState> = {};
  for (const account of accounts) {
    const check = checks[account.base];
    if (check) kept[account.base] = check;
  }
  return kept;
}

export const useForgeAccountsStore = create<ForgeAccountsState>((set, get) => {
  let pending: Promise<ForgeAccount[]> | null = null;
  let request = 0;
  let listening = false;

  const listen = () => {
    if (listening) return;
    listening = true;
    const failed = (error: unknown) => {
      listening = false;
      void logError("forge accounts listen", error);
    };
    try {
      onForgeAccountsChanged(() => {
        void get().reload();
      }).catch(failed);
    } catch (error) {
      failed(error);
    }
  };

  const fetchAccounts = (): Promise<ForgeAccount[]> => {
    const id = ++request;
    if (get().status !== "ready") set({ status: "loading" });
    const run = forgeAccountsList()
      .then((accounts) => {
        if (id === request) {
          set((state) => ({
            status: "ready",
            accounts,
            error: null,
            checks: keepChecks(state.checks, accounts),
          }));
        }
        return get().accounts;
      })
      .catch((error) => {
        void logError("forge accounts", error);
        if (id === request) set({ status: "error", error: describeError(error) });
        return get().accounts;
      })
      .finally(() => {
        if (pending === run) pending = null;
      });
    pending = run;
    return run;
  };

  return {
    status: "idle",
    accounts: [],
    checks: {},
    error: null,

    ensureLoaded: () => {
      listen();
      const state = get();
      if (state.status === "ready") return Promise.resolve(state.accounts);
      return pending ?? fetchAccounts();
    },

    reload: () => {
      listen();
      return fetchAccounts();
    },

    signInWithToken: async ({ base, kind, token, caFile }) => {
      const account = await forgeSignInToken(base, kind, token, caFile ?? null);
      get().accountSignedIn(account);
      return account;
    },

    accountSignedIn: (account) => {
      set((state) => ({
        status: "ready",
        accounts: upsert(state.accounts, account),
        checks: { ...state.checks, [account.base]: "ok" },
      }));
    },

    signOut: async (base) => {
      await forgeSignOut(base);
      set((state) => {
        const checks = { ...state.checks };
        delete checks[base];
        return {
          accounts: state.accounts.filter((account) => account.base !== base),
          checks,
        };
      });
    },

    setCaFile: async (base, caFile) => {
      const account = await forgeSetCaFile(base, caFile);
      set((state) => ({ accounts: upsert(state.accounts, account) }));
      return account;
    },

    validateAll: async () => {
      const accounts = get().accounts;
      if (accounts.length === 0) return;
      set((state) => {
        const checks = { ...state.checks };
        for (const account of accounts) checks[account.base] = "checking";
        return { checks };
      });
      await Promise.all(
        accounts.map(async (account) => {
          try {
            const result = await forgeValidate(account.base);
            set((state) => {
              // Signed out while the check ran: leave it gone.
              if (!state.accounts.some((existing) => existing.base === account.base)) return {};
              const checked = result.account;
              return {
                checks: { ...state.checks, [account.base]: result.state },
                accounts: checked
                  ? state.accounts.map((existing) => (existing.base === checked.base ? checked : existing))
                  : state.accounts,
              };
            });
          } catch (error) {
            void logError("forge account check", error);
            set((state) => {
              const checks = { ...state.checks };
              delete checks[account.base];
              return { checks };
            });
          }
        }),
      );
    },
  };
});
