import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  api,
  onInvalidChildSelection,
  setChildSelectionRequired,
  setSelectedChildId,
} from '../api/client';
import { useAuth } from './AuthContext';

const Context = createContext(null);

export function ParentChildProvider({ children }) {
  const { user } = useAuth();
  const [childrenList, setChildrenList] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [childrenError, setChildrenError] = useState('');
  const requestId = useRef(0);
  setChildSelectionRequired(user?.role === 'PARENT');

  const loadChildren = useCallback(async (preserve = true) => {
    const currentRequest = ++requestId.current;
    setLoadingChildren(true);
    setChildrenError('');
    try {
      const result = await api('/students', 'GET', undefined, {
        withoutSelectedChild: true,
      });
      if (requestId.current !== currentRequest) return;
      const linked = result.items || [];
      setChildrenList(linked);
      setSelectedChild(current => {
        const next =
          preserve && linked.find(child => child._id === current?._id);
        const selected = next || linked[0] || null;
        setSelectedChildId(selected?._id || '');
        return selected;
      });
    } catch (error) {
      if (requestId.current === currentRequest) {
        setChildrenList([]);
        setSelectedChild(null);
        setSelectedChildId('');
        setChildrenError(error.message);
      }
    } finally {
      if (requestId.current === currentRequest) setLoadingChildren(false);
    }
  }, []);

  useEffect(() => {
    requestId.current += 1;
    setChildrenList([]);
    setSelectedChild(null);
    setSelectedChildId('');
    setChildrenError('');
    if (user?.role === 'PARENT') loadChildren(false);
    return () => {
      requestId.current += 1;
    };
  }, [user?._id, user?.role, loadChildren]);

  useEffect(
    () =>
      onInvalidChildSelection(() => {
        setSelectedChild(null);
        setSelectedChildId('');
        loadChildren(false);
      }),
    [loadChildren],
  );

  const selectChild = useCallback(
    id => {
      const child = childrenList.find(item => item._id === id) || null;
      setSelectedChild(child);
      setSelectedChildId(child?._id || '');
    },
    [childrenList],
  );

  const value = useMemo(
    () => ({
      children: childrenList,
      selectedChild,
      selectedChildId: selectedChild?._id || '',
      loadingChildren,
      childrenError,
      selectChild,
      refreshChildren: () => loadChildren(true),
    }),
    [
      childrenList,
      selectedChild,
      loadingChildren,
      childrenError,
      selectChild,
      loadChildren,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useParentChild() {
  const context = useContext(Context);
  if (!context)
    throw new Error('useParentChild must be used inside ParentChildProvider');
  return context;
}
