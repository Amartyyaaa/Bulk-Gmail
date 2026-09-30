import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';

/**
 * Subscribe to Postgres changes on the given tables and call `onChange`
 * (debounced) whenever one fires. Used to keep stats live as ESP webhooks land.
 */
export function useRealtime(channelName, tables, onChange, { filter, delay = 800 } = {}) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const tableList = tables.join(',');

  useEffect(() => {
    let timer;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), delay);
    };
    let channel = supabase.channel(`${channelName}-${Math.random().toString(36).slice(2)}`);
    for (const table of tableList.split(',')) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, fire);
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [channelName, tableList, filter, delay]);
}

/** Load campaign_stats rows, keyed by campaign_id. */
export function useCampaignStats(campaignId) {
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from('campaign_stats').select('*');
    if (campaignId) q = q.eq('campaign_id', campaignId);
    const { data } = await q;
    setStats(Object.fromEntries((data ?? []).map((r) => [r.campaign_id, r])));
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtime(
    'stats',
    ['campaign_recipients', 'events'],
    load,
    campaignId ? { filter: `campaign_id=eq.${campaignId}`, delay: 1000 } : { delay: 2000 },
  );

  return { stats, loading, reload: load };
}

export function useTags() {
  const [tags, setTags] = useState([]);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('all_tags');
    setTags(data ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { tags, reload: load };
}

export function useSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('*').single();
    setSettings(data);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { settings, loading, reload: load, setSettings };
}

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
