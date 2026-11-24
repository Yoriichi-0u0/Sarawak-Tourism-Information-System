import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "../lib/api";
import type { Account } from "../shared/contracts";

type SessionState = {
  account: Account | null | undefined;
  refresh: () => Promise<Account | null>;
  setAccount: (account: Account | null) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>();
  const refresh = useCallback(async () => {
    try {
      const { account: current } = await api<{ account: Account | null }>("auth/session");
      setAccount(current);
      return current;
    } catch {
      setAccount(null);
      return null;
    }
  }, []);
  const signOut = useCallback(async () => {
    await api("auth/logout", { method: "POST" });
    setAccount(null);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const value = useMemo(() => ({ account, refresh, setAccount, signOut }), [account, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}

export const isStaff = (account: Account | null | undefined) => account?.role === "staff" || account?.role === "admin";
