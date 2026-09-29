import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Search, ShieldOff, Trash2, Upload, Users } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useDebounced, useTags } from '../lib/hooks.js';
import { dateTime, num } from '../lib/format.js';
import { isValidEmail } from '@shared/render.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, ConfirmDialog, EmptyState, Field, Modal, PageHeader, Pager, Skeleton, Tag, TagInput, Tabs,
} from '../components/ui.jsx';
import ImportModal from '../components/ImportModal.jsx';

const PAGE = 50;

/** PostgREST `or` filters use , ( ) as syntax — strip them from user input. */
const safe = (s) => s.replace(/[,()*%\\]/g, ' ').trim();

export default function Contacts() {
  const [tab, setTab] = useState('contacts');
  return (
    <>
      <PageHeader title="Contacts" description="Your subscribers, their consent status, and addresses you must never email." />
      <Tabs
        label="Contacts sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'contacts', label: 'Contacts' },
          { value: 'suppression', label: 'Suppression list' },
        ]}
      />
      <div className="tab-panel">{tab === 'contacts' ? <ContactList /> : <SuppressionList />}</div>
    </>
  );
}

function ContactList() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { tags, reload: reloadTags } = useTags();
  const [rows, setRows] = useState(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null); // contact | {} for new
  const [deleting, setDeleting] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const q = useDebounced(search);

  const load = useCallback(async () => {
    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    const term = safe(q);
    if (term) query = query.or(`email.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    if (tag) query = query.contains('tags', [tag]);
    if (status === 'subscribed') query = query.eq('opt_in', true);
    if (status === 'unsubscribed') query = query.eq('opt_in', false);
    const { data, count: c, error } = await query;
    if (error) toast.error(error);
    setRows(data ?? []);
    setCount(c ?? 0);
  }, [page, q, tag, status, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(0), [q, tag, status]);

  const refresh = () => {
    load();
    reloadTags();
  };

  const remove = async () => {
    const { error } = await supabase.from('contacts').delete().eq('id', deleting.id);
    if (error) return toast.error(error);
    toast.success('Contact deleted');
    setDeleting(null);
    refresh();
  };

  const filtered = q || tag || status !== 'all';

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          <label className="search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search contacts</span>
            <input type="search" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="select-label">
            <span className="sr-only">Filter by tag</span>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.tag} value={t.tag}>{t.tag} ({num(t.contacts)})</option>
              ))}
            </select>
          </label>
          <label className="select-label">
            <span className="sr-only">Filter by subscription status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Any status</option>
              <option value="subscribed">Opted in</option>
              <option value="unsubscribed">Not opted in / unsubscribed</option>
            </select>
          </label>
        </div>
        {isAdmin && (
          <div className="page-actions">
            <Button icon={Upload} onClick={() => setImportOpen(true)}>Import CSV</Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Add contact</Button>
          </div>
        )}
      </div>

      <div className="card">
        {rows === null ? (
          <div className="card-body"><Skeleton rows={8} /></div>
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={Search} title="No contacts match">Try clearing the search or filters.</EmptyState>
          ) : (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              action={isAdmin && <Button variant="primary" icon={Upload} onClick={() => setImportOpen(true)}>Import a CSV</Button>}
            >
              Import your subscriber list (name, email, tags) to get started. Only opted-in contacts are ever emailed.
            </EmptyState>
          )
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Contact</th>
                    <th scope="col">Tags</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="hide-md">Source</th>
                    <th scope="col" className="hide-md">Added</th>
                    {isAdmin && <th scope="col"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="truncate strong">{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</div>
                        <div className="truncate small muted">{c.email}</div>
                      </td>
                      <td>
                        <div className="tag-list">{c.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
                      </td>
                      <td>
                        {c.opt_in ? (
                          <span className="badge badge-good">Opted in</span>
                        ) : c.unsubscribed_at ? (
                          <span className="badge badge-bad" title={`Unsubscribed ${dateTime(c.unsubscribed_at)}`}>Unsubscribed</span>
                        ) : (
                          <span className="badge badge-neutral">No consent</span>
                        )}
                      </td>
                      <td className="hide-md small">{c.opt_in_source || '—'}</td>
                      <td className="hide-md small nowrap">{dateTime(c.created_at)}</td>
                      {isAdmin && (
                        <td className="row-actions">
                          <button type="button" className="icon-btn" onClick={() => setEditing(c)} aria-label={`Edit ${c.email}`}>
                            <Pencil size={16} />
                          </button>
                          <button type="button" className="icon-btn" onClick={() => setDeleting(c)} aria-label={`Delete ${c.email}`}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pages={Math.max(1, Math.ceil(count / PAGE))} count={count} onPage={setPage} />
          </>
        )}
      </div>

      <ContactModal contact={editing} tags={tags} onClose={() => setEditing(null)} onSaved={refresh} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} knownTags={tags.map((t) => t.tag)} />
      <ConfirmDialog open={!!deleting} title="Delete contact?" danger confirmLabel="Delete" onConfirm={remove} onClose={() => setDeleting(null)}>
        <p>
          <strong>{deleting?.email}</strong> will be removed. If they unsubscribed, their address stays on the suppression list so
          they can’t be re-imported and emailed.
        </p>
      </ConfirmDialog>
    </>
  );
}

function ContactModal({ contact, tags, onClose, onSaved }) {
  const toast = useToast();
  const isNew = contact && !contact.id;
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [suppressed, setSuppressed] = useState(null);

  useEffect(() => {
    if (!contact) return;
    setForm({
      email: contact.email ?? '',
      first_name: contact.first_name ?? '',
      last_name: contact.last_name ?? '',
      tags: contact.tags ?? [],
      opt_in: contact.opt_in ?? false,
      opt_in_source: contact.opt_in_source ?? 'manual',
    });
    setErrors({});
    setSuppressed(null);
    if (contact.email) {
      supabase.from('suppression_list').select('reason').eq('email', contact.email).maybeSingle()
        .then(({ data }) => setSuppressed(data?.reason ?? null));
    }
  }, [contact]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!isValidEmail(form.email)) next.email = 'Enter a valid email address.';
    if (form.opt_in && !form.opt_in_source.trim()) next.opt_in_source = 'Record where consent came from (e.g. “website form”).';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const payload = { ...form, email: form.email.trim().toLowerCase() };
    const { error } = isNew
      ? await supabase.from('contacts').insert(payload)
      : await supabase.from('contacts').update(payload).eq('id', contact.id);
    setBusy(false);
    if (error) {
      if (error.code === '23505') setErrors({ email: 'A contact with this email already exists.' });
      else toast.error(error);
      return;
    }
    toast.success(isNew ? 'Contact added' : 'Contact updated');
    onSaved();
    onClose();
  };

  return (
    <Modal open={!!contact} title={isNew ? 'Add contact' : 'Edit contact'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="contact-form" loading={busy}>Save</Button></>}>
      <form id="contact-form" onSubmit={submit} noValidate className="form-grid">
        <Field label="Email" error={errors.email} required>
          <input type="email" value={form.email ?? ''} onChange={set('email')} disabled={!isNew} />
        </Field>
        <div className="form-row">
          <Field label="First name"><input value={form.first_name ?? ''} onChange={set('first_name')} /></Field>
          <Field label="Last name"><input value={form.last_name ?? ''} onChange={set('last_name')} /></Field>
        </div>
        <Field label="Tags" hint="Press Enter to add a tag.">
          <TagInput value={form.tags ?? []} onChange={set('tags')} suggestions={tags.map((t) => t.tag)} />
        </Field>
        {suppressed ? (
          <div className="alert alert-warn">
            This address is on the suppression list ({suppressed.replace('_', ' ')}) and can’t be emailed. Remove it from the suppression
            list only if the person has explicitly re-subscribed.
          </div>
        ) : (
          <>
            <label className="checkbox">
              <input type="checkbox" checked={!!form.opt_in} onChange={set('opt_in')} />
              <span>This person has opted in to receive marketing email</span>
            </label>
            {form.opt_in && (
              <Field label="Consent source" error={errors.opt_in_source} required hint="Keep a record of how you got consent.">
                <input value={form.opt_in_source ?? ''} onChange={set('opt_in_source')} placeholder="Website signup form" />
              </Field>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

const REASONS = { unsubscribed: 'Unsubscribed', hard_bounce: 'Hard bounce', complaint: 'Spam complaint', manual: 'Added manually' };

function SuppressionList() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState(null);
  const q = useDebounced(search);

  const load = useCallback(async () => {
    let query = supabase
      .from('suppression_list')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    const term = safe(q);
    if (term) query = query.ilike('email', `%${term}%`);
    const { data, count: c, error } = await query;
    if (error) toast.error(error);
    setRows(data ?? []);
    setCount(c ?? 0);
  }, [page, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async () => {
    const { error } = await supabase.from('suppression_list').delete().eq('email', removing.email);
    if (error) return toast.error(error);
    toast.success('Removed from suppression list');
    setRemoving(null);
    load();
  };

  return (
    <>
      <div className="alert alert-info">
        Addresses here are never emailed — they’re skipped when a campaign is queued and checked again right before each send.
        Unsubscribes, hard bounces and spam complaints are added automatically.
      </div>
      <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search suppression list</span>
          <input type="search" placeholder="Search email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {isAdmin && <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>Suppress address</Button>}
      </div>

      <div className="card">
        {rows === null ? (
          <div className="card-body"><Skeleton rows={5} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldOff} title={q ? 'No matches' : 'Suppression list is empty'}>
            {q ? 'No suppressed address matches your search.' : 'Nobody has unsubscribed, bounced or complained yet.'}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Email</th><th scope="col">Reason</th><th scope="col">Added</th>
                    {isAdmin && <th scope="col"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.email}>
                      <td className="truncate">{r.email}</td>
                      <td><span className={`badge ${r.reason === 'manual' ? 'badge-neutral' : 'badge-bad'}`}>{REASONS[r.reason]}</span></td>
                      <td className="small nowrap">{dateTime(r.created_at)}</td>
                      {isAdmin && (
                        <td className="row-actions">
                          <button type="button" className="icon-btn" onClick={() => setRemoving(r)} aria-label={`Remove ${r.email} from suppression list`}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pages={Math.max(1, Math.ceil(count / PAGE))} count={count} onPage={setPage} />
          </>
        )}
      </div>

      <AddSuppressionModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={load} />
      <ConfirmDialog open={!!removing} title="Remove from suppression list?" danger confirmLabel="Remove" onConfirm={remove} onClose={() => setRemoving(null)}>
        <p>
          Only do this if <strong>{removing?.email}</strong> has explicitly asked to receive email again
          {removing?.reason === 'hard_bounce' ? ' and the address is now valid' : ''}. Their contact stays opted out until you re-enable it.
        </p>
      </ConfirmDialog>
    </>
  );
}

function AddSuppressionModal({ open, onClose, onAdded }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setError('');
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    setBusy(true);
    const { error: err } = await supabase.from('suppression_list').insert({ email: email.trim().toLowerCase(), reason: 'manual', source: 'admin' });
    setBusy(false);
    if (err) {
      if (err.code === '23505') setError('This address is already suppressed.');
      else toast.error(err);
      return;
    }
    toast.success('Address suppressed');
    onAdded();
    onClose();
  };

  return (
    <Modal open={open} title="Suppress an address" onClose={onClose} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="suppress-form" loading={busy}>Suppress</Button></>}>
      <form id="suppress-form" onSubmit={submit} noValidate>
        <Field label="Email" error={error} required hint="This address will never be emailed by any campaign.">
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}
