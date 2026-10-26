import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ApiError } from '../../services/api/apiClient';

// Focus/retry/refresh each has a generation. Blur and unmount invalidate
// responses without remounting the screen or losing its selected context.
export function useTeacherResource<T>(
  load: () => Promise<T>,
  unavailableMessage = 'This assigned class is unavailable or you no longer have access.',
  enabled = true,
) {
  const generation = useRef(0);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    // Hide stale academic data while current authority is being revalidated.
    setData(null);
    try {
      const result = await load();
      if (request === generation.current) setData(result);
    } catch (failure) {
      if (request === generation.current) {
        setError(
          failure instanceof ApiError && failure.status === 404
            ? unavailableMessage
            : failure instanceof Error
            ? failure.message
            : 'Unable to load. Please retry.',
        );
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [load, unavailableMessage]);
  useFocusEffect(
    useCallback(() => {
      if (enabled) refresh();
      return () => {
        generation.current += 1;
      };
    }, [refresh, enabled]),
  );
  return { data, loading, error, refresh };
}
