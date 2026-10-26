import { useEffect, useRef, useState } from 'react';
import { parentApi } from '../../roles/parent/parentService';
import { parentPreview } from '../data/previewData';

const rows = value => (Array.isArray(value) ? value : []);
const recordId = value => String(value?.id || value?._id || '');
const isPreview = enabled =>
  Boolean(enabled && typeof __DEV__ !== 'undefined' && __DEV__);

export default function useParentChildren(
  previewOnly,
  initialChildId = '',
  onChildChange,
) {
  const preview = isPreview(previewOnly);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState(initialChildId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setChildren([]);
    Promise.resolve()
      .then(() => (preview ? parentPreview.children : parentApi.getChildren()))
      .then(data => {
        if (request !== generation.current) return;
        const next = rows(data);
        setChildren(next);
        setSelectedId(current =>
          next.some(child => recordId(child) === current)
            ? current
            : recordId(next[0]),
        );
      })
      .catch(failure => {
        if (request === generation.current) {
          setError(failure.message || 'Could not load your children.');
          setSelectedId('');
        }
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [preview, revision]);

  useEffect(() => {
    if (initialChildId) setSelectedId(initialChildId);
  }, [initialChildId]);

  const selected = children.find(child => recordId(child) === selectedId);
  return {
    children,
    selected,
    selectedId: selected ? selectedId : '',
    loading,
    error,
    preview,
    refresh: () => setRevision(value => value + 1),
    select: child => {
      const id = recordId(child);
      setSelectedId(id);
      onChildChange?.(id);
    },
  };
}
