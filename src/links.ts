// Every Flipzi link this server prints carries UTMs (docs/utm-convention.md: medium "integration").
// Only flipzi.io URLs are tagged; nothing else is ever touched.
export const CAMPAIGN = '202610_mcp';

export function tag(url: string, content?: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== 'flipzi.io' && !u.hostname.endsWith('.flipzi.io')) return url;
    u.searchParams.set('utm_source', 'mcp');
    u.searchParams.set('utm_medium', 'integration');
    u.searchParams.set('utm_campaign', CAMPAIGN);
    if (content) u.searchParams.set('utm_content', content.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40));
    return u.toString();
  } catch {
    return url;
  }
}

export const signupUrl = (content = 'no-key') => tag('https://flipzi.io/account/register?product=data', content);
export const keysUrl = (content = 'bad-key') => tag('https://flipzi.io/account/keys', content);
export const pricingUrl = (content = 'pricing') => tag('https://flipzi.io/api/pricing/', content);
