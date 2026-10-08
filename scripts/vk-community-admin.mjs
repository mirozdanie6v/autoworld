/**
 * One-shot admin-only operations for AUTO MIR VK community (242103542).
 * This script never touches the site, Mini App or deployment.
 * Dry-run by default. To apply: AWG_VK_APPLY=YES_APPLY.
 */
const GROUP_ID = 242103542;
const WELCOME_POST_ID = 1;
const CANONICAL_WEBSITE = 'https://www.awgcars.ru/';
const LINK_TEXT = 'Каталог автомобилей';
const VK_API_VERSION = '5.199';

export function normalizedUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
    return `${hostname}${normalizedPath}`;
  } catch { return ''; }
}
export function resolveGroup(response) { return response?.groups?.[0] ?? response?.[0] ?? null; }
export function groupIsAdmin(group) { return group && Number(group.id) === GROUP_ID && Number(group.is_admin) === 1; }
export function existingSiteLink(links) {
  return Array.isArray(links) && links.some((link) => normalizedUrl(link.url) === normalizedUrl(CANONICAL_WEBSITE));
}
export function pinStatus(wall) {
  if (!wall || !Array.isArray(wall.items)) return 'unknown';
  const welcome = wall.items.find((item) => Number(item.id) === WELCOME_POST_ID);
  if (welcome && (welcome.is_pinned === 1 || welcome.is_pinned === true)) return 'pinned';
  if (wall.items.some((item) => Number(item.id) === WELCOME_POST_ID)) return 'unpinned';
  return 'unknown';
}
export function makeVkApi(fetchImpl, token) {
  return async (method, params = {}) => {
    const response = await fetchImpl(`https://api.vk.com/method/${method}`, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({...params, access_token: token, v: VK_API_VERSION}),
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) throw new Error(`VK ${method}: http ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`VK ${method}: code ${Number(payload.error.error_code) || 0}`);
    return payload.response;
  };
}
export async function runAdminSetup({token, apply = false, fetchImpl = fetch, logger = console} = {}) {
  if (!token || typeof token !== 'string') throw new Error('AWG_VK_ADMIN_TOKEN secret is missing');
  const api = makeVkApi(fetchImpl, token);
  const identity = await api('users.get');
  const userId = Number(identity?.[0]?.id || 0);
  if (!userId) throw new Error('User token required: users.get denied or empty');
  const group = resolveGroup(await api('groups.getById', {
    group_ids: String(GROUP_ID), fields: 'is_admin,admin_level,links,site,description'
  }));
  if (!groupIsAdmin(group)) throw new Error('Authenticated user is not an admin of the expected group');
  const wall = await api('wall.get', {owner_id: String(-GROUP_ID), count: 100});
  const posts = Array.isArray(wall?.items) ? wall.items : [];
  if (!posts.some((item) => Number(item.id) === WELCOME_POST_ID)) {
    throw new Error('Expected welcome post #1 is missing; stop without edits');
  }
  const linkExists = existingSiteLink(group.links);
  const pinned = pinStatus(wall) === 'pinned';
  const report = {group_id: GROUP_ID, user_id: userId, mode: apply ? 'apply' : 'dry-run', admin: true,
    website_already_linked: linkExists, welcome_already_pinned: pinned,
    planned: {pin_welcome: !pinned, add_site_link: !linkExists}};
  logger.log(JSON.stringify({step: 'preflight', ...report}));
  if (!apply) return report;
  if (!pinned) {
    await api('wall.pin', {owner_id: String(-GROUP_ID), post_id: String(WELCOME_POST_ID)});
    logger.log(JSON.stringify({step: 'pinned', url: `https://vk.com/wall-${GROUP_ID}_${WELCOME_POST_ID}`}));
  }
  if (!linkExists) {
    await api('groups.addLink', {group_id: String(GROUP_ID), link: CANONICAL_WEBSITE, text: LINK_TEXT});
    logger.log(JSON.stringify({step: 'added_site_link', site: CANONICAL_WEBSITE}));
  }
  const after = resolveGroup(await api('groups.getById', {group_ids: String(GROUP_ID), fields: 'links'}));
  const wallAfter = await api('wall.get', {owner_id: String(-GROUP_ID), count: 100});
  const verified = {site_link_present: existingSiteLink(after?.links), welcome_pinned: pinStatus(wallAfter) === 'pinned'};
  logger.log(JSON.stringify({step: 'verify', ...verified}));
  if (!verified.site_link_present || !verified.welcome_pinned) throw new Error('VK admin changes could not be verified');
  return {...report, verified};
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runAdminSetup({token: process.env.AWG_VK_ADMIN_TOKEN, apply: process.env.AWG_VK_APPLY === 'YES_APPLY'})
    .catch(error => { console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1; });
}
