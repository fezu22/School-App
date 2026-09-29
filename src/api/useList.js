import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from './client';

// Loads { items } from an endpoint every time the screen is focused.
export function useList(path) {
  const [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setItems((await api(path)).items);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { items, loading, error, setError, load };
}
