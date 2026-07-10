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

  // Fill obvious "why this company / cover letter" textareas with provided text.
  function autofill(answer) {
    let filled = 0
    const fields = document.querySelectorAll('textarea, input[type="text"]')
    for (const f of fields) {
      const label = ((f.getAttribute('aria-label') || f.getAttribute('name') || f.placeholder || '') + ' ' + (f.labels && f.labels[0] ? f.labels[0].textContent : '')).toLowerCase()
      if (/why|cover|interest|motivat|about you|tell us/.test(label) && f.tagName === 'TEXTAREA' && !f.value) {
        f.value = answer; f.dispatchEvent(new Event('input', { bubbles: true })); filled++
      }
    }
    return filled
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'scrape') sendResponse(scrape())
    else if (msg.type === 'autofill') sendResponse({ filled: autofill(msg.answer || '') })
    return true
  })
})();
