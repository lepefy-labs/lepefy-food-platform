import { useEffect, useRef, useState } from 'react';

export type SettingsFeedbackState = { type: 'success' | 'error'; msg: string } | null;

/** Inline save feedback: success clears itself, errors stay until the next action. */
export function useSettingsFeedback() {
  const [feedback, setFeedback] = useState<SettingsFeedbackState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function show(msg: string, type: 'success' | 'error') {
    if (timer.current) clearTimeout(timer.current);
    setFeedback({ msg, type });
    if (type === 'success') timer.current = setTimeout(() => setFeedback(null), 3000);
  }

  return { feedback, show, clear: () => setFeedback(null) };
}
