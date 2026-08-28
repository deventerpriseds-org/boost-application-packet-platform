import { supportIn, gateProgress } from '/home/user/boost-application-packet-platform/api/dist/functions/tests/requirementSupport.js'
const REQS = [
 [0,'responsibility','Lead engineering execution across software products and client-facing projects.'],
 [1,'responsibility','Define and execute technology, platform, and architecture strategies.'],
 [2,'responsibility','Manage engineering priorities, capacity, resource allocation, and delivery tradeoffs.'],
 [3,'responsibility','Establish engineering standards, governance, metrics, and operating practices.'],
 [4,'responsibility','Drive continuous improvement through DevSecOps practices and automation.'],
 [5,'responsibility','Monitor and optimize engineering performance based on key metrics.'],
 [6,'responsibility','Ensure compliance with cybersecurity, data protection, and AI governance.'],
 [7,'responsibility','Identify opportunities for applying emerging technologies.'],
 [8,'responsibility','Guide the responsible adoption of AI-powered tools and intelligent automation.'],
 [9,'responsibility','Build and develop high-performing engineering teams.'],
 [10,'responsibility','Create an environment that promotes innovation and accountability.'],
 [11,'responsibility','Build strong partnerships across various business functions.'],
 [12,'must_have','Demonstrated success in leading software engineering organizations.'],
 [13,'must_have','Strong understanding of cloud platforms and modern software delivery practices.'],
 [14,'must_have','Working knowledge of applied AI and machine learning operations.'],
 [15,'must_have','Ability to align engineering strategy with business goals.'],
 [16,'must_have','Experience managing complex portfolios and competing priorities.'],
 [17,'must_have','Strong collaboration and communication skills.'],
 [18,'must_have','15 years of related experience with at least 3 in leadership.'],
 [19,'nice_to_have','Preferred experience in infrastructure, utilities, and environmental services.'],
 [20,'nice_to_have',"Bachelor's degree in a relevant technical field."],
]
const ITEMS = [
 ['SkillsBullets1','Engineering Execution'],['SkillsBullets1','Technology Strategy'],['SkillsBullets1','Business Alignment'],
 ['SkillsBullets1','Governance Standards'],['SkillsBullets1','Continuous Improvement'],['SkillsBullets1','Performance Monitoring'],
 ['SkillsBullets1','Cybersecurity Compliance'],['SkillsBullets1','Innovation Leadership'],['SkillsBullets1','AI Adoption'],
 ['SkillsBullets1','Culture of Innovation'],
 ['SkillsBullets2','Accountability'],['SkillsBullets2','Performance Expectations'],['SkillsBullets2','Technical Mentorship'],
 ['SkillsBullets2','Cross-Functional Teams'],['SkillsBullets2','Stakeholder Engagement'],['SkillsBullets2','Value Opportunity Focus'],
 ['SkillsBullets2','Resource Allocation'],['SkillsBullets2','Risk Management'],['SkillsBullets2','Team Development'],
 ['SkillsBullets2','Operational Excellence'],
]

const furthest = (item) => {
  let best = null
  for (const [seq, kind, req] of REQS) {
    const r = supportIn({ requirement:req, recordText:item, threshold:0.5, maxSentences:2,
      minQuoteChars:0, minQuoteWords:0, distinctiveLen:6 })
    if (r?.ok) return { ok:true, seq, kind, req, support:r.support||0 }
    const p = gateProgress(r?.reason ?? null)
    if (!best || p > best.p) best = { ok:false, p, reason:r?.reason, seq, kind, req }
  }
  return best
}
const out = ITEMS.map(([slot,item]) => ({ slot, item, ...furthest(item) }))
console.log(JSON.stringify(out, null, 1))
