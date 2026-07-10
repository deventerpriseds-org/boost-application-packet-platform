import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { TableClient, odata } from '@azure/data-tables'

// App Portal — one place to see every Azure Static Web App we've launched.
//
// SWAs get auto-generated hostnames like `purple-ground-0f377120f` that are
// impossible to remember. This scans the subscription for every
// Microsoft.Web/staticSites resource and merges in curated display names +
// descriptions (stored in the AppConfig table, partition 'apps') so the apps
// are findable by a human name, all from a single URL.

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const META_TABLE = 'AppConfig'
const META_PARTITION = 'apps'

// Service-principal creds. The deploy SP is synced onto the Function App both
// as AZURE_* (added in api-deploy.yml) and, historically, as MICROSOFT_* (it
// doubles as the Graph app). Fall back through both, then to known constants.
const CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || ''
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || ''
const TENANT_ID = process.env.AZURE_TENANT_ID || process.env.MICROSOFT_TENANT_ID || 'ee633423-c321-413c-a191-ace8b07e4196'
const SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID || '09594120-1b35-4e21-84c6-451ac27175a3'

const json = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

interface CuratedMeta {
  displayName?: string
  description?: string
  hidden?: boolean
  order?: number
}

interface AppEntry {
  name: string
  displayName: string
  description: string
  url: string | null
  hostname: string | null
  location: string
  resourceGroup: string
  repositoryUrl: string | null
  sku: string | null
  createdAt: string | null
  lastModifiedAt: string | null
  isNew: boolean          // created within the last 48h
  hidden: boolean
  order: number | null
  tags: Record<string, string>
}

// Acquire an ARM access token via client-credentials flow.
async function getArmToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Service principal not configured (AZURE_CLIENT_ID / AZURE_CLIENT_SECRET missing on Function App).')
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: 'https://management.azure.com/.default'
  })
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Token request failed (HTTP ${res.status}): ${t.slice(0, 300)}`)
  }
  const data = await res.json() as { access_token?: string }
  if (!data.access_token) throw new Error('Token response missing access_token')
  return data.access_token
}

// List every Static Web App in the subscription (following ARM paging).
async function listStaticSites(token: string): Promise<any[]> {
  const sites: any[] = []
  let url: string | null =
    `https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.Web/staticSites?api-version=2024-04-01`
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(`ARM staticSites list failed (HTTP ${res.status}): ${t.slice(0, 300)}`)
    }
    const page = await res.json() as { value?: any[]; nextLink?: string }
    if (page.value) sites.push(...page.value)
    url = page.nextLink || null
  }
  return sites
}

// Load curated display names / descriptions keyed by SWA resource name.
async function loadCurated(): Promise<Record<string, CuratedMeta>> {
  const out: Record<string, CuratedMeta> = {}
  try {
    const client = TableClient.fromConnectionString(CONN, META_TABLE)
    for await (const e of client.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${META_PARTITION}` } })) {
      out[e.rowKey as string] = {
        displayName: (e.displayName as string) || undefined,
        description: (e.description as string) || undefined,
        hidden: (e.hidden as boolean) || false,
        order: typeof e.order === 'number' ? (e.order as number) : undefined
      }
    }
  } catch {
    // AppConfig may not have any 'apps' rows yet — that's fine.
  }
  return out
}

function rgFromId(id: string): string {
  const m = /resourceGroups\/([^/]+)/i.exec(id || '')
  return m ? m[1] : ''
}

// Turn "purple-ground-0f377120f" into a readable fallback: "Purple Ground".
// Drops the trailing random-hash segment when present.
function humanize(name: string): string {
  const parts = name.split('-')
  if (parts.length > 1 && /^[0-9a-f]{6,}$/i.test(parts[parts.length - 1])) parts.pop()
  return parts
    .map(p => p ? p[0].toUpperCase() + p.slice(1) : p)
    .join(' ')
    .trim() || name
}

const FOURTY_EIGHT_H = 48 * 60 * 60 * 1000

// GET /api/apps — scan + merge. POST /api/apps — save curated metadata.
export async function apps(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: json }

  if (req.method === 'POST') {
    try {
      const body = await req.json() as { name?: string; displayName?: string; description?: string; hidden?: boolean; order?: number }
      if (!body.name) return { status: 400, headers: json, jsonBody: { success: false, error: 'name is required' } }
      const client = TableClient.fromConnectionString(CONN, META_TABLE)
      const entity: { partitionKey: string; rowKey: string; [k: string]: unknown } =
        { partitionKey: META_PARTITION, rowKey: body.name }
      if (body.displayName !== undefined) entity.displayName = body.displayName
      if (body.description !== undefined) entity.description = body.description
      if (body.hidden !== undefined) entity.hidden = body.hidden
      if (body.order !== undefined) entity.order = body.order
      await client.upsertEntity(entity, 'Merge')
      return { status: 200, headers: json, jsonBody: { success: true, name: body.name } }
    } catch (err) {
      return { status: 500, headers: json, jsonBody: { success: false, error: String(err) } }
    }
  }

  // GET
  try {
    const [token, curated] = await Promise.all([getArmToken(), loadCurated()])
    const sites = await listStaticSites(token)
    const now = Date.now()

    const entries: AppEntry[] = sites.map(site => {
      const name = site.name as string
      const meta = curated[name] || {}
      const props = site.properties || {}
      const sysData = site.systemData || {}
      const created = sysData.createdAt || null
      const createdMs = created ? Date.parse(created) : NaN
      const hostname = props.defaultHostname || null
      return {
        name,
        displayName: meta.displayName || humanize(name),
        description: meta.description || '',
        url: hostname ? `https://${hostname}` : null,
        hostname,
        location: site.location || '',
        resourceGroup: rgFromId(site.id || ''),
        repositoryUrl: props.repositoryUrl || null,
        sku: (site.sku && site.sku.name) || null,
        createdAt: created,
        lastModifiedAt: sysData.lastModifiedAt || null,
        isNew: !isNaN(createdMs) && (now - createdMs) <= FOURTY_EIGHT_H,
        hidden: !!meta.hidden,
        order: meta.order ?? null,
        tags: site.tags || {}
      }
    })

    // Sort: pinned order first (if set), then newest created, then name.
    entries.sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order
      if (a.order != null) return -1
      if (b.order != null) return 1
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0
      if (tb !== ta) return tb - ta
      return a.displayName.localeCompare(b.displayName)
    })

    return {
      status: 200,
      headers: json,
      jsonBody: {
        success: true,
        count: entries.length,
        subscription: SUBSCRIPTION_ID,
        scannedAt: new Date().toISOString(),
        apps: entries
      }
    }
  } catch (err) {
    return { status: 500, headers: json, jsonBody: { success: false, error: String(err) } }
  }
}

app.http('apps', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'apps',
  handler: apps
})

// GET /api/portal — the human-facing dashboard page. Self-contained HTML that
// calls /api/apps. Stable URL: https://job-platform-api.azurewebsites.net/api/portal
export async function portal(req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    body: PORTAL_HTML
  }
}

app.http('portal', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'portal',
  handler: portal
})

const PORTAL_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>App Portal — Azure Static Web Apps</title>
<style>
  :root {
    --bg: #0b0f1a; --panel: #141b2d; --panel-2: #1b2438; --border: #263049;
    --text: #e6ebf5; --muted: #8a97b1; --accent: #6ea8fe; --accent-2: #4ade80;
    --new: #fbbf24; --danger: #f87171; --radius: 14px;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f4f6fb; --panel: #ffffff; --panel-2: #f0f3fa; --border: #dde3ef;
      --text: #101627; --muted: #5b6781; --accent: #2563eb; --accent-2: #16a34a;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { padding: 28px 24px 8px; max-width: 1200px; margin: 0 auto; }
  h1 { margin: 0; font-size: 24px; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px; }
  h1 .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent-2); box-shadow: 0 0 12px var(--accent-2); }
  .sub { color: var(--muted); margin: 6px 0 0; font-size: 13px; }
  .toolbar { max-width: 1200px; margin: 16px auto 0; padding: 0 24px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  input.search { flex: 1; min-width: 200px; background: var(--panel); border: 1px solid var(--border);
    color: var(--text); padding: 10px 14px; border-radius: 10px; font-size: 14px; }
  button { background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    padding: 9px 14px; border-radius: 10px; cursor: pointer; font-size: 13px; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .grid { max-width: 1200px; margin: 20px auto 60px; padding: 0 24px;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px; display: flex; flex-direction: column; gap: 10px; position: relative; transition: border-color .15s; }
  .card:hover { border-color: var(--accent); }
  .card.hidden-app { opacity: .5; }
  .card .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .name { font-size: 17px; font-weight: 640; letter-spacing: -0.01em; word-break: break-word; }
  .badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
    padding: 3px 7px; border-radius: 999px; white-space: nowrap; }
  .badge.new { background: var(--new); color: #201800; }
  .desc { color: var(--muted); font-size: 13.5px; min-height: 18px; white-space: pre-wrap; word-break: break-word; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .meta code { background: var(--panel-2); padding: 1px 6px; border-radius: 6px; font-size: 11px; }
  .actions { display: flex; gap: 8px; margin-top: auto; padding-top: 6px; flex-wrap: wrap; }
  a.open { text-decoration: none; }
  a.open button { background: var(--accent); border-color: var(--accent); color: #fff; }
  .muted-btn { color: var(--muted); }
  .edit-row { display: none; flex-direction: column; gap: 8px; }
  .card.editing .edit-row { display: flex; }
  .card.editing .view-row { display: none; }
  .edit-row input, .edit-row textarea { background: var(--panel-2); border: 1px solid var(--border);
    color: var(--text); padding: 8px 10px; border-radius: 8px; font-size: 13px; width: 100%; font-family: inherit; }
  .edit-row textarea { resize: vertical; min-height: 54px; }
  .status { max-width: 1200px; margin: 0 auto; padding: 0 24px; color: var(--muted); font-size: 13px; }
  .error { color: var(--danger); background: rgba(248,113,113,.1); border: 1px solid var(--danger);
    padding: 14px 16px; border-radius: 10px; margin: 8px 0; white-space: pre-wrap; }
  .empty { text-align: center; color: var(--muted); padding: 60px 20px; }
  .spin { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--muted);
    border-top-color: transparent; border-radius: 50%; animation: r .7s linear infinite; vertical-align: -2px; }
  @keyframes r { to { transform: rotate(360deg); } }
  footer { text-align: center; color: var(--muted); font-size: 12px; padding: 20px; }
</style>
</head>
<body>
  <header>
    <h1><span class="dot"></span> App Portal</h1>
    <p class="sub">Every Azure Static Web App in the subscription, in one place. Give them names you'll remember.</p>
  </header>
  <div class="toolbar">
    <input class="search" id="search" placeholder="Filter by name, description, URL…" autocomplete="off">
    <label style="display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;">
      <input type="checkbox" id="showHidden"> show hidden
    </label>
    <button id="refresh" class="primary">↻ Rescan</button>
  </div>
  <div class="status" id="status"></div>
  <div class="grid" id="grid"></div>
  <footer>Served by job-platform-api · data from Azure Resource Manager</footer>

<script>
const API = ''; // same origin as this page (/api/*)
let ALL = [];

const el = (id) => document.getElementById(id);
const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function load() {
  el('status').innerHTML = '<span class="spin"></span> Scanning Azure…';
  el('grid').innerHTML = '';
  try {
    const res = await fetch(API + '/api/apps');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Scan failed');
    ALL = data.apps || [];
    el('status').textContent = data.count + ' app' + (data.count === 1 ? '' : 's') +
      ' · scanned ' + new Date(data.scannedAt).toLocaleTimeString();
    render();
  } catch (e) {
    el('status').innerHTML = '<div class="error">Could not scan Azure:\\n' + esc(e.message) +
      '\\n\\nThe service principal on the Function App needs Reader on the subscription.</div>';
  }
}

function render() {
  const q = el('search').value.trim().toLowerCase();
  const showHidden = el('showHidden').checked;
  const grid = el('grid');
  const list = ALL.filter(a => {
    if (a.hidden && !showHidden) return false;
    if (!q) return true;
    return (a.displayName + ' ' + a.description + ' ' + a.name + ' ' + (a.url||'') + ' ' +
            Object.values(a.tags||{}).join(' ')).toLowerCase().includes(q);
  });
  if (!list.length) {
    grid.innerHTML = '<div class="empty">' + (ALL.length ? 'No apps match your filter.' : 'No Static Web Apps found in this subscription.') + '</div>';
    return;
  }
  grid.innerHTML = list.map(cardHtml).join('');
}

function cardHtml(a) {
  const created = fmtDate(a.createdAt);
  const meta = [];
  if (created) meta.push('created ' + esc(created));
  if (a.location) meta.push('<code>' + esc(a.location) + '</code>');
  if (a.resourceGroup) meta.push(esc(a.resourceGroup));
  return \`<div class="card \${a.hidden ? 'hidden-app' : ''}" data-name="\${esc(a.name)}">
    <div class="view-row" style="display:flex;flex-direction:column;gap:10px;">
      <div class="top">
        <div class="name">\${esc(a.displayName)}</div>
        \${a.isNew ? '<span class="badge new">new</span>' : ''}
      </div>
      <div class="desc">\${esc(a.description) || '<em style="opacity:.6">No description yet — click Edit to add one.</em>'}</div>
      <div class="meta">
        <span title="Azure resource name">\${esc(a.name)}</span>
      </div>
      <div class="meta">\${meta.join(' · ')}</div>
      <div class="actions">
        \${a.url ? '<a class="open" href="' + esc(a.url) + '" target="_blank" rel="noopener"><button>Open ↗</button></a>' : ''}
        \${a.repositoryUrl ? '<a class="open" href="' + esc(a.repositoryUrl) + '" target="_blank" rel="noopener"><button class="muted-btn">Repo</button></a>' : ''}
        <button class="muted-btn" onclick="edit(this)">Edit</button>
      </div>
    </div>
    <div class="edit-row">
      <input class="e-name" value="\${esc(a.displayName)}" placeholder="Display name">
      <textarea class="e-desc" placeholder="What is this app? Notes to future-you…">\${esc(a.description)}</textarea>
      <label style="display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px;">
        <input type="checkbox" class="e-hidden" \${a.hidden ? 'checked' : ''}> hide from portal
      </label>
      <div class="actions">
        <button class="primary" onclick="save(this)">Save</button>
        <button onclick="cancel(this)">Cancel</button>
      </div>
    </div>
  </div>\`;
}

function edit(btn) { btn.closest('.card').classList.add('editing'); }
function cancel(btn) { btn.closest('.card').classList.remove('editing'); }

async function save(btn) {
  const card = btn.closest('.card');
  const name = card.dataset.name;
  const displayName = card.querySelector('.e-name').value.trim();
  const description = card.querySelector('.e-desc').value;
  const hidden = card.querySelector('.e-hidden').checked;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch(API + '/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, displayName, description, hidden })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Save failed');
    const app = ALL.find(a => a.name === name);
    if (app) { app.displayName = displayName || app.displayName; app.description = description; app.hidden = hidden; }
    card.classList.remove('editing');
    render();
  } catch (e) {
    alert('Could not save: ' + e.message);
  } finally { btn.disabled = false; btn.textContent = 'Save'; }
}

el('search').addEventListener('input', render);
el('showHidden').addEventListener('change', render);
el('refresh').addEventListener('click', load);
load();
</script>
</body>
</html>`
