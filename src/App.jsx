import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { Spinner } from './components/ui.jsx';
import { isConfigured } from './lib/supabase.js';
import Login from './pages/Login.jsx';

const Campaigns = lazy(() => import('./pages/Campaigns.jsx'));
const CampaignEditor = lazy(() => import('./pages/CampaignEditor.jsx'));
const CampaignReport = lazy(() => import('./pages/CampaignReport.jsx'));
const Contacts = lazy(() => import('./pages/Contacts.jsx'));
const Analytics = lazy(() => import('./pages/Analytics.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Unsubscribe = lazy(() => import('./pages/Unsubscribe.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

export default function App() {
  if (!isConfigured) {
    return (
      <div className="center-screen">
        <div className="card card-body narrow">
          <h1>Connect Supabase</h1>
          <p className="muted">
            Copy <code>.env.example</code> to <code>.env.local</code> and set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/unsubscribe" element={<Unsubscribe />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/campaigns" replace />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/new" element={<CampaignEditor />} />
            <Route path="/campaigns/:id/edit" element={<CampaignEditor />} />
            <Route path="/campaigns/:id" element={<CampaignReport />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
