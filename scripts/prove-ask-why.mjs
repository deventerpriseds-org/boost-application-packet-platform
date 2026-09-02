import pw from '/home/user/boost-application-packet-platform/app/node_modules/playwright-core/index.js'
const { chromium } = pw
import { createServer } from 'node:http'; import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'; import { join, extname, resolve } from 'node:path'
const D = resolve('/home/user/boost-application-packet-platform/app/dist')
const FIX = JSON.parse(await readFile('/tmp/fx-trinnex.json','utf8'))
const M={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'}
const srv=createServer(async(q,r)=>{let f=join(D,decodeURIComponent(q.url.split('?')[0]));try{if(existsSync(f)&&statSync(f).isDirectory())f=join(f,'index.html')}catch{};if(!existsSync(f))f=join(D,'index.html');try{const b=await readFile(f);r.writeHead(200,{'content-type':M[extname(f)]||'application/octet-stream'});r.end(b)}catch{r.writeHead(500);r.end()}})
await new Promise(r=>srv.listen(8994,r))
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
const p=await b.newPage({viewport:{width:1280,height:1400}})
await p.route('**/api/**',async(r)=>{const u=new URL(r.request().url());const path=u.pathname+u.search;const k=Object.keys(FIX).filter(x=>path.includes(x)).sort((a,c)=>c.length-a.length)[0];r.fulfill({status:200,contentType:'application/json',body:k?JSON.stringify(FIX[k]):'{}'})})
await p.addInitScript(()=>localStorage.setItem('ee_auth_user',JSON.stringify({email:'von.ellis@enterpriseds.io',name:'Von Ellis',provider:'google'})))
await p.goto('http://localhost:8994/#/packet/9f9c370a-4ac9-441e-b58e-02e3ffcf669e/qc',{waitUntil:'domcontentloaded'})
await p.waitForTimeout(4500)

await p.getByText('Original vs final', { exact: true }).first().click()
await p.waitForTimeout(1200)

const pass = (ok, label, extra='') => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' -- ' + extra : ''}`)
const btn = p.locator('[data-qc="qc-ask-why"]').first()
const n = await p.locator('[data-qc="qc-ask-why"]').count()
pass(n > 0, `Ask why renders on the swap rows`, `${n} button(s)`)
const artifactId = await btn.getAttribute('data-qc-artifact')
pass(!!artifactId, 'the button is bound to an artifact', artifactId || 'null')

const before = await p.evaluate(() => document.body.innerText)
pass(!/Why did you change/i.test(before), 'no seeded question on screen BEFORE the click')

await btn.click()
await p.waitForTimeout(1600)
// The seed lands in a TEXTAREA VALUE. document.body.innerText does not include form field
// values, so reading it there reports a working feature as broken -- which is what it did.
const seeded = await p.evaluate(() => {
  const t = [...document.querySelectorAll('textarea,input')].map(e => e.value || '').find(v => /Why did you change/i.test(v))
  return t || ''
})
const m = seeded ? [seeded] : null
pass(!!m, 'a "Why did you change" question appears AFTER the click')
console.log('  seeded text:', m ? JSON.stringify(m[0]) : '(none)')
pass(!/skills_[12]|relevant_[123]/.test(m ? m[0] : ''), 'the question names a LABEL, not the raw list enum')
pass(/Skills 1|Skills 2|Relevant/i.test(m ? m[0] : ''), 'the question names the human list name')

// SPEC: it SEEDS the panel; it must not send anything on the owner's behalf.
// SPEC: it SEEDS the panel. Proving it did not SEND: the text is still sitting in the field.
const stillInField = await p.evaluate(() => [...document.querySelectorAll('textarea')].some(t => /Why did you change/i.test(t.value || '')))
pass(stillInField, 'the question is UNSENT, still sitting in the composer')
const panelOpen = await p.evaluate(() => /Assistant/.test(document.body.innerText))
pass(panelOpen, 'the assistant panel is open')

await p.screenshot({ path: '/tmp/askwhy-proof.png', fullPage: false })
console.log('  screenshot: /tmp/askwhy-proof.png')
await b.close(); srv.close()
