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

async function detectFields(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }) } catch (e) {}
  return await new Promise((res) => chrome.tabs.sendMessage(tabId, { type: 'detectFields' }, (r) => res(r || { fields: [] })))
}
function fillFields(tabId, answers) {
  return new Promise((res) => chrome.tabs.sendMessage(tabId, { type: 'fillFields', answers }, (r) => res(r || { filled: 0 })))
}

document.getElementById('fill').addEventListener('click', async () => {
  const btn = document.getElementById('fill'); const out = document.getElementById('result')
  btn.disabled = true; out.className = 'result'; out.textContent = 'Reading the form…'
  try {
    const cfg = await getCfg()
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const det = await detectFields(tab.id)
    const fields = det.fields || []
    if (!fields.length) { out.className = 'result err'; out.textContent = 'No fillable questions found on this page.'; return }
    out.textContent = `Drafting ${fields.length} answers…`
    // Also grab company/role context from the page.
    const page = await new Promise((res) => chrome.tabs.sendMessage(tab.id, { type: 'scrape' }, (r) => res(r || {})))
    const headers = { 'Content-Type': 'application/json' }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`
    const r = await fetch(`${cfg.apiBase}/app/answers/from-questions`, {
      method: 'POST', headers,
      body: JSON.stringify({ questions: fields.map((f) => f.label), company: page.company, role: page.title, url: det.url, owner: cfg.token ? undefined : cfg.owner }),
    })
    const d = await r.json()
    if (d.error) { out.className = 'result err'; out.textContent = `⚠ ${d.error}`; return }
    const filledRes = await fillFields(tab.id, d.answers || [])
    out.className = 'result ok'
    out.innerHTML = `✓ Filled <b>${filledRes.filled}</b> of ${fields.length} fields. Review, attach your resume file, and submit.`
  } catch (e) {
    out.className = 'result err'; out.textContent = `⚠ ${e.message || e}`
  } finally { btn.disabled = false }
})

getCfg().then((cfg) => { document.getElementById('openApp').href = cfg.appUrl || DEFAULT_APP })
document.getElementById('opts').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() })
