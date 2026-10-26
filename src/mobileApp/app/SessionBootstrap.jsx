import { useEffect } from 'react';
import { restoreSession } from '../shared/services/authService';

export default function SessionBootstrap({ disabled = false, onComplete }) {
  useEffect(() => {
    let active = true;
    if (disabled) {
      onComplete(null, null);
      return () => {
        active = false;
      };
    }
    restoreSession()
      .then(user => {
        if (active) onComplete(user, null);
      })
      .catch(error => {
        if (active) onComplete(null, error);
      });
    return () => {
      active = false;
    };
  }, [disabled, onComplete]);

  return null;
}
