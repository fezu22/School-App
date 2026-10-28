import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { principalService } from '../services/principal/principalService';
import { PrincipalDashboardData } from '../services/principal/principalService';

export const usePrincipalDashboardData = () => {
  const { accessToken } = useAuth();
  const [data, setData] = useState<PrincipalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (!accessToken) {
      setError('Your session is unavailable. Please sign in again.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await principalService.getDashboard(accessToken);
      if (current === generation.current) setData(response.data);
    } catch (requestError: unknown) {
      if (current === generation.current)
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load dashboard data.',
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
      return () => {
        ++generation.current;
      };
    }, [reload]),
  );

  return { data, loading, error, reload };
};
