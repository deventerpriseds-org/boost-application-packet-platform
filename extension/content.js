// Scrape the current page for a job posting. Heuristic: prefer JSON-LD JobPosting,
// fall back to <title>/<h1> + visible body text. Also exposes a simple autofill.
(function () {
  function fromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent)
        const arr = Array.isArray(data) ? data : [data]
        for (const d of arr) {
          const t = d && (d['@type'] || (d['@graph'] && 'graph'))
          if (d && (d['@type'] === 'JobPosting' || (Array.isArray(d['@type']) && d['@type'].includes('JobPosting')))) {
            return {
              title: d.title || '',
              company: (d.hiringOrganization && d.hiringOrganization.name) || '',
              location: (d.jobLocation && (d.jobLocation.address ? (d.jobLocation.address.addressLocality || '') : '')) || '',
              text: (d.description || '').replace(/<[^>]+>/g, ' ').slice(0, 6000),
            }
          }
        }
      } catch (e) { /* ignore */ }
    }
    return null
  }
  function scrape() {
    const ld = fromJsonLd()
    if (ld && ld.title) return { url: location.href, ...ld }
    const h1 = document.querySelector('h1')
    const title = (h1 && h1.textContent.trim()) || document.title || ''
    // Best-effort company from meta or og:site_name
    const site = document.querySelector('meta[property="og:site_name"]')
    const company = (site && site.content) || (location.hostname.replace(/^www\./, '').split('.')[0]) || ''
    const text = (document.body ? document.body.innerText : '').slice(0, 6000)
    return { url: location.href, title, company, location: '', text }
  }

  // --- Universal auto-apply: detect the real form fields, then fill them back ---

  // Best label for a field: <label for>, wrapping <label>, aria-label, aria-labelledby,
  // nearby preceding text, name, or placeholder.
  function labelFor(el) {
    if (el.labels && el.labels[0]) return el.labels[0].textContent.trim()
    const al = el.getAttribute('aria-label'); if (al) return al.trim()
    const lb = el.getAttribute('aria-labelledby')
    if (lb) { const n = document.getElementById(lb); if (n) return n.textContent.trim() }
    // Walk up for a container that has a label-like element.
    let p = el.closest('label, .field, .form-group, [class*="question"], [class*="field"], li, div')
    if (p) {
      const lab = p.querySelector('label, legend, .label, [class*="label"]')
      if (lab && !lab.contains(el)) { const t = lab.textContent.trim(); if (t) return t }
    }
    return (el.getAttribute('name') || el.placeholder || '').trim()
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false
    if (el.offsetParent === null && el.type !== 'hidden') { /* hidden by layout */ }
    if (el.tagName === 'TEXTAREA') return true
    if (el.tagName === 'INPUT') return ['text', 'email', 'tel', 'url', 'search', 'number', ''].includes((el.type || 'text').toLowerCase())
    return false
  }

  // Collect fillable fields, tag each with a ref so we can fill it back reliably.
  function detectFields() {
    const els = document.querySelectorAll('input, textarea')
    const out = []
    let i = 0
    for (const el of els) {
      if (!isFillable(el)) continue
      const label = labelFor(el)
      if (!label || label.length > 300) continue
      el.setAttribute('data-ee-field', String(i))
      out.push({ ref: i, label, tag: el.tagName.toLowerCase(), type: (el.type || 'text').toLowerCase(), hasValue: !!el.value })
      i++
    }
    return out
  }

  // React/Angular-safe value set: use the native setter, then dispatch input+change.
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(el, value); else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // Fill answers[] positionally by the ref we assigned in detectFields().
  function fillFields(answers, overwrite) {
    let filled = 0
    for (let r = 0; r < answers.length; r++) {
      const a = answers[r]
      if (!a) continue
      const el = document.querySelector(`[data-ee-field="${r}"]`)
      if (!el) continue
      if (el.value && !overwrite) continue
      setValue(el, a); filled++
    }
    return filled
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'scrape') sendResponse(scrape())
    else if (msg.type === 'detectFields') sendResponse({ fields: detectFields(), url: location.href, title: document.title })
    else if (msg.type === 'fillFields') sendResponse({ filled: fillFields(msg.answers || [], !!msg.overwrite) })
    return true
  })
})();
