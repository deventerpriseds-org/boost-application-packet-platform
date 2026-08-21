import { readdirSync, existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
function chromiumPath() {
  const root = '/opt/pw-browsers'
  for (const d of readdirSync(root).filter(d => d.startsWith('chromium-')).sort().reverse()) {
    const exe = `${root}/${d}/chrome-linux/chrome`
    if (existsSync(exe)) return exe
  }
}
const server = await createServer({ root: '.', server: { port: 0 }, logLevel: 'error' })
await server.listen()
const { port } = server.httpServer.address()
const browser = await chromium.launch({ executablePath: chromiumPath() })
const page = await browser.newPage()
await page.goto(`http://localhost:${port}/test/browser/overlay-probe.html`)
await page.waitForSelector('#toggle-dark')
const info = await page.evaluate(() => {
  const sheets = [...document.styleSheets].map(s => ({ href: s.href, owner: s.ownerNode?.tagName, id: s.ownerNode?.getAttribute?.('data-vite-dev-id'), n: (()=>{try{return s.cssRules.length}catch{return 'THREW'}})() }))
  const styleTags = [...document.querySelectorAll('style')].map(t => ({ id: t.getAttribute('data-vite-dev-id'), len: t.textContent.length, head: t.textContent.slice(0,60) }))
  const sels = []
  try { for (const r of document.styleSheets[0].cssRules) sels.push(String(r.selectorText || r.cssText.slice(0,40))) } catch {}
  const colored = []
  const walk = (list) => { for (const r of list) { if (r.cssRules && r.cssRules.length && !r.selectorText) { walk(r.cssRules); continue } if (!r.style || !r.selectorText) continue
    const c = r.style.getPropertyValue('color'); if (c) colored.push([r.selectorText, c, r.style.getPropertyValue('background'), r.style.getPropertyValue('background-color'), r.style.getPropertyValue('font-size'), r.style.getPropertyValue('font-weight')]) } }
  walk(document.styleSheets[0].cssRules)
  return { sheets, styleTags, sels: sels.slice(0, 100), colored }
})
console.log(JSON.stringify(info.sheets, null, 1))
console.log('style tags:', JSON.stringify(info.styleTags, null, 1).slice(0, 2000))
console.log('COLORED', info.colored.length); for (const c of info.colored) console.log(' ', JSON.stringify(c))
await browser.close(); await server.close()
