import { useState } from 'react';
import { Accordion } from './ui';

export function Feedback() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setStatus('sending');
    setError(null);
    try {
      const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      if (res.ok) return setStatus('sent');
      setError((await res.json().catch(() => null))?.error ?? "That didn't send. Try again.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setStatus('idle');
  };

  return (
    <Accordion title="Send feedback" tone="ash">
      {status === 'sent' ? (
        <p className="font-semibold text-spark">Feedback sent. Thank you!</p>
      ) : (
        <>
          <p>This is an early build. Tell me what broke, what was confusing, or what you’d like to see.</p>
          <textarea className="field resize-none" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your feedback here" aria-label="Feedback" />
          <button className="btn btn-quiet w-full" onClick={send} disabled={!text.trim() || status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send feedback'}
          </button>
          {error && <p className="text-danger" role="alert">{error}</p>}
        </>
      )}
    </Accordion>
  );
}
