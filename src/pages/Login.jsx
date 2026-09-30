import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Field } from '../components/ui.jsx';
import { isValidEmail } from '@shared/render.js';

export default function Login() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to={location.state?.from?.pathname || '/campaigns'} replace />;

  const validate = () => {
    const next = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!isValidEmail(email)) next.email = 'Enter a valid email address, like name@company.com.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    return !Object.keys(next).length;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!validate()) return;
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) setFormError(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
    else navigate(location.state?.from?.pathname || '/campaigns', { replace: true });
  };

  return (
    <div className="auth-screen">
      <form className="auth-card card card-body" onSubmit={onSubmit} noValidate>
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true"><Mail size={20} /></span>
          <h1>Sign in to Mailroom</h1>
          <p className="muted">Email marketing for your team.</p>
        </div>

        {formError && <div className="alert alert-error" role="alert">{formError}</div>}

        <Field label="Email" error={errors.email} required>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email && !isValidEmail(email) && setErrors((x) => ({ ...x, email: 'Enter a valid email address, like name@company.com.' }))}
          />
        </Field>
        <Field label="Password" error={errors.password} required>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>

        <Button type="submit" variant="primary" loading={loading} className="btn-block">
          Sign in
        </Button>
        <p className="muted small center">Accounts are created by an admin in Supabase Auth.</p>
      </form>
    </div>
  );
}
