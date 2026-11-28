import { useEffect, useRef, useState } from 'react';

// Shared status banner, loading flag, short-lived toast, and error handling for user actions.
export function useFeedback() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the timeout if the app shell unmounts while a toast is still visible.
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const showToast = (message: string) => {
    // Restart the timer so a newer message stays visible for the full display period.
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 3600);
  };

  const runAction = async <T,>(label: string, operation: () => Promise<T>): Promise<T | null> => {
    // Wrap short async actions with a consistent loading and error-notice lifecycle.
    setBusy(true);
    setNotice('');
    try {
      const result = await operation();
      if (label) setNotice(label);
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Something went wrong.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { busy, setBusy, notice, setNotice, toast, showToast, runAction };
}
