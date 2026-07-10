const DEFAULT_API = 'https://job-platform-api.azurewebsites.net/api'
const DEFAULT_APP = 'https://purple-ground-0f377120f.7.azurestaticapps.net/'

function getCfg() {
  return new Promise((res) => chrome.storage.sync.get({ apiBase: DEFAULT_API, appUrl: DEFAULT_APP, owner: '', token: '' }, res))
}

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  // Ensure the content script is present, then ask it to scrape.
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }) } catch (e) {}
  return await new Promise((res) => chrome.tabs.sendMessage(tab.id, { type: 'scrape' }, (r) => res(r || { url: tab.url, title: tab.title })))
}

document.getElementById('save').addEventListener('click', async () => {
  const btn = document.getElementById('save'); const out = document.getElementById('result')
  btn.disabled = true; out.textContent = 'Reading this page…'; out.className = 'result'
  try {
    const cfg = await getCfg()
    const page = await scrapeActiveTab()
    out.textContent = 'Saving…'
    const headers = { 'Content-Type': 'application/json' }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`
    const body = { url: page.url, title: page.title, company: page.company, text: page.text }
    if (cfg.owner && !cfg.token) body.owner = cfg.owner
    const r = await fetch(`${cfg.apiBase}/app/capture`, { method: 'POST', headers, body: JSON.stringify(body) })
    const d = await r.json()
    if (d.error) { out.className = 'result err'; out.textContent = `⚠ ${d.error}`; return }
    const o = d.opportunity || {}
    out.className = 'result ok'
    out.innerHTML = d.inserted ? `✓ Saved <b>${o.role || ''}</b> at <b>${o.company || ''}</b> to your pipeline.` : `Already in your pipeline (${d.reason || 'duplicate'}).`
  } catch (e) {
    out.className = 'result err'; out.textContent = `⚠ ${e.message || e}`
  } finally { btn.disabled = false }
})

getCfg().then((cfg) => { document.getElementById('openApp').href = cfg.appUrl || DEFAULT_APP })
document.getElementById('opts').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() })
