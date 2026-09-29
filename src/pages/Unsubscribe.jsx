import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, MailX } from 'lucide-react';
import { publicFunction } from '../lib/supabase.js';
import { Button, Spinner } from '../components/ui.jsx';

/** Public one-click unsubscribe page linked from every email footer. */
export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('t');
  const recipient = params.get('r');
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ phase: 'error', message: 'This unsubscribe link is incomplete.' });
      return;
    }
    publicFunction('unsubscribe', { query: { t: token } })
      .then((d) => setState({ phase: d.subscribed ? 'confirm' : 'done', email: d.email }))
      .catch((e) => setState({ phase: 'error', message: e.message }));
  }, [token]);

  const unsubscribe = async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      const d = await publicFunction('unsubscribe', { method: 'POST', body: { token, recipient_id: recipient } });
      setState({ phase: 'done', email: d.email });
    } catch (e) {
      setState({ phase: 'error', message: e.message });
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card card card-body center" aria-live="polite">
        {state.phase === 'loading' && <Spinner />}
        {state.phase === 'confirm' && (
          <>
            <MailX size={40} className="accent" aria-hidden="true" />
            <h1>Unsubscribe</h1>
            <p>
              Stop all marketing emails to <strong>{state.email}</strong>?
            </p>
            <Button variant="primary" className="btn-block" loading={state.busy} onClick={unsubscribe}>
              Unsubscribe
            </Button>
          </>
        )}
        {state.phase === 'done' && (
          <>
            <CheckCircle2 size={40} className="good" aria-hidden="true" />
            <h1>You’re unsubscribed</h1>
            <p className="muted">
              {state.email ? <><strong>{state.email}</strong> won’t</> : 'You won’t'} receive any more marketing emails from us.
            </p>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <MailX size={40} className="bad" aria-hidden="true" />
            <h1>Link not valid</h1>
            <p className="muted">{state.message} Reply to any of our emails and we’ll remove you manually.</p>
          </>
        )}
      </div>
    </div>
  );
}
