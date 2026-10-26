import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../../services/api/apiClient';
import { useFocusEffect } from '@react-navigation/native';

// Mutations are separately guarded: no optimistic authority or success,
// synchronous duplicate-click exclusion, and no old-screen confirmation.
export function useTimetableAction(
  context: string,
  refresh: () => Promise<void>,
) {
  const guard = useRef({ epoch: 0, active: false, busy: false, context });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      guard.current.context = context;
      guard.current.active = true;
      setPending(false);
      setNotice(null);
      setError(null);
      return () => {
        guard.current.active = false;
        guard.current.epoch++;
        guard.current.busy = false;
      };
    }, [context]),
  );
  const run = useCallback(
    async (request: () => Promise<unknown>, confirmation: string) => {
      const g = guard.current;
      if (!g.active || g.busy) return false;
      g.busy = true;
      const epoch = ++g.epoch;
      setPending(true);
      setNotice(null);
      setError(null);
      try {
        await request();
        if (!g.active || epoch !== g.epoch) return false;
        await refresh();
        if (!g.active || epoch !== g.epoch) return false;
        setNotice(confirmation);
        return true;
      } catch (failure) {
        if (
          g.active &&
          epoch === g.epoch &&
          failure instanceof ApiError &&
          [401, 403, 404, 409].includes(failure.status)
        )
          await refresh();
        if (g.active && epoch === g.epoch)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Timetable action failed.',
          );
        return false;
      } finally {
        if (g.active && epoch === g.epoch) {
          g.busy = false;
          setPending(false);
        }
      }
    },
    [refresh],
  );
  return { pending, notice, error, run };
}
