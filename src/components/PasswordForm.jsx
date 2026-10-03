import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { Button, Field } from './ui.jsx';

const MIN_LENGTH = 8;

/** New password + confirmation for the signed-in user (settings or recovery link). */
export default function PasswordForm({ onDone, submitLabel = 'Update password' }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const next = {};
    if (password.length < MIN_LENGTH) next.password = `Use at least ${MIN_LENGTH} characters.`;
    if (confirm !== password) next.confirm = 'Passwords don’t match.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setPassword('');
    setConfirm('');
    onDone?.();
  };

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      {formError && <div className="alert alert-error" role="alert">{formError}</div>}
      <Field label="New password" error={errors.password} required hint={`At least ${MIN_LENGTH} characters.`}>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm new password" error={errors.confirm} required>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant="primary" icon={KeyRound} loading={saving}>{submitLabel}</Button>
      </div>
    </form>
  );
}
