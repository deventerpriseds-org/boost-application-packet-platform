const DEFAULTS = { apiBase: 'https://job-platform-api.azurewebsites.net/api', appUrl: 'https://purple-ground-0f377120f.7.azurestaticapps.net/', owner: '', token: '' }
const ids = ['owner', 'token', 'apiBase', 'appUrl']

chrome.storage.sync.get(DEFAULTS, (cfg) => { for (const k of ids) document.getElementById(k).value = cfg[k] || '' })

document.getElementById('save').addEventListener('click', () => {
  const cfg = {}
  for (const k of ids) cfg[k] = document.getElementById(k).value.trim()
  chrome.storage.sync.set(cfg, () => { document.getElementById('status').textContent = 'Saved ✓'; setTimeout(() => document.getElementById('status').textContent = '', 1500) })
})
