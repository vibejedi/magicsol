import { useCallback, useEffect, useState } from "react";
import { getLobby, type Lobby } from "@/lib/arena/server";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export function useLobby() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!userId) return Promise.resolve();
    setLoading(true);
    return getLobby()
      .then((data) => {
        setLobby(data);
        setError(null);
      })
      .catch(() => setError("The pit ledger didn't answer."))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLobby(null);
      return;
    }
    let cancel = false;
    setLoading(true);
    getLobby()
      .then((data) => {
        if (cancel) return;
        setLobby(data);
        setError(null);
      })
      .catch(() => {
        if (!cancel) setError("The pit ledger didn't answer.");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [userId]);

  return { user, isPending, lobby, error, loading, refresh, signedIn: Boolean(userId) };
}
