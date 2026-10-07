/** How a campaign is handed to the email provider (campaigns.delivery). */
export const DELIVERY_METHODS = [
  { value: 'individual', label: 'Individual emails', hint: 'One email per person, throttled in batches. Full per-person tracking in this app.' },
  {
    value: 'broadcast',
    label: 'Resend Broadcast',
    hint: 'Recipients are added to Resend and sent one Broadcast. Needs a Resend API key with Full access; unsubscribes use Resend’s link.',
  },
];

export const deliveryLabel = (value) => DELIVERY_METHODS.find((d) => d.value === value)?.label ?? DELIVERY_METHODS[0].label;
export const deliveryHint = (value) => DELIVERY_METHODS.find((d) => d.value === value)?.hint ?? '';
