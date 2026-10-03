import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useToast } from '../context/ToastContext.jsx';
import PasswordForm from '../components/PasswordForm.jsx';
import { Spinner } from '../components/ui.jsx';

/**
 * Landing page for the "reset your password" email. Supabase signs the user in
 * from the link, then they choose a new password here.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState('checking'); // checking | ready | invalid

  useEffect(() => {
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        settled = true;
        setState('ready');
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setState('ready');
      }
    });
    // The recovery token is exchanged asynchronously; give it a moment.
    const timer = setTimeout(() => !settled && setState('invalid'), 4000);
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="auth-screen">
      <div className="auth-card card card-body">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true"><KeyRound size={20} /></span>
          <h1>Choose a new password</h1>
        </div>
        {state === 'checking' && <Spinner label="Checking your reset link…" />}
        {state === 'ready' && (
          <PasswordForm
            submitLabel="Save new password"
            onDone={() => {
              toast.success('Password updated');
              navigate('/campaigns', { replace: true });
            }}
          />
        )}
        {state === 'invalid' && (
          <>
            <div className="alert alert-error" role="alert">
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </div>
            <Link to="/login" className="btn btn-primary btn-block">Back to sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
