import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Mail, MailCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { Button, Field } from '../components/ui.jsx';
import { isValidEmail } from '@shared/render.js';

const INVALID_EMAIL = 'Enter a valid email address, like name@company.com.';

export default function Login() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('signin'); // signin | forgot | sent
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to={location.state?.from?.pathname || '/quick-send'} replace />;

  const validate = () => {
    const next = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!isValidEmail(email)) next.email = INVALID_EMAIL;
    if (mode === 'signin' && !password) next.password = 'Enter your password.';
    setErrors(next);
    return !Object.keys(next).length;
  };

  const switchMode = (next) => {
    setMode(next);
    setErrors({});
    setFormError('');
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!validate()) return;
    setLoading(true);

    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setLoading(false);
      if (error) setFormError(error.message);
      else setMode('sent');
      return;
    }

    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) setFormError(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
    else navigate(location.state?.from?.pathname || '/quick-send', { replace: true });
  };

  if (mode === 'sent') {
    return (
      <div className="auth-screen">
        <div className="auth-card card card-body center">
          <MailCheck size={40} className="good" aria-hidden="true" />
          <h1>Check your email</h1>
          <p className="muted">
            If an account exists for <strong>{email.trim()}</strong>, we’ve sent a link to reset your password. It can take a minute
            to arrive, so check your spam folder too.
          </p>
          <Button className="btn-block" onClick={() => switchMode('signin')}>Back to sign in</Button>
        </div>
      </div>
    );
  }

  const forgot = mode === 'forgot';

  return (
    <div className="auth-screen">
      <form className="auth-card card card-body" onSubmit={onSubmit} noValidate>
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true"><Mail size={20} /></span>
          <h1>{forgot ? 'Reset your password' : 'Sign in to Mailroom'}</h1>
          <p className="muted">
            {forgot ? 'Enter your email and we’ll send you a reset link.' : 'Email marketing for your team.'}
          </p>
        </div>

        {formError && <div className="alert alert-error" role="alert">{formError}</div>}

        <Field label="Email" error={errors.email} required>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email && !isValidEmail(email) && setErrors((x) => ({ ...x, email: INVALID_EMAIL }))}
          />
        </Field>
        {!forgot && (
          <Field label="Password" error={errors.password} required>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}

        <Button type="submit" variant="primary" loading={loading} className="btn-block">
          {forgot ? 'Send reset link' : 'Sign in'}
        </Button>
        <p className="small center">
          <button type="button" className="link-btn" onClick={() => switchMode(forgot ? 'signin' : 'forgot')}>
            {forgot ? 'Back to sign in' : 'Forgot your password?'}
          </button>
        </p>
        {!forgot && <p className="muted small center">Accounts are created by an admin in Supabase Auth.</p>}
      </form>
    </div>
  );
}
