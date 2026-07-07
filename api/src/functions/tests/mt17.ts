import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const MOCK_INPUTS = {
  call1: {
    resumeSummary: 'Visionary technology executive with 20+ years driving digital transformation.',
    skills1: 'Enterprise Architecture | Cloud Strategy | DevSecOps',
    skills2: 'Agile Transformation | SaaS Platforms | M&A Integration',
    expertise: 'Digital Transformation | Engineering Leadership | Platform Modernization',
    workHistory1: 'Led enterprise software strategy across 15 global markets',
    workHistory2: 'Directed digital engineering organization of 120+ engineers',
    workHistory3: 'Architected corporate information solutions platform',
    workHistory4: 'Delivered GIS and water infrastructure analytics systems',
    relevant1: 'Agile Portfolio Mgmt',
    relevant2: 'SaaS Platforms',
    relevant3: 'Data Governance',
    coverLetter: 'Dear Hiring Manager, I am excited to apply for the VP of Engineering role at TechVenture Inc...',
    aboutMe1: 'I lead with innovation and build high-performing engineering cultures across global markets.',
    aboutMe2: 'As a technology executive I have scaled organizations from 20 to 150+ engineers.',
    executiveProfile: 'Technology executive with proven track record delivering enterprise platforms at scale.',
    coreAccomplishments: '• Led $25M digital transformation\n• Scaled engineering org to 150+ engineers\n• Delivered 3 SaaS platforms',
    targetRole: 'VP of Engineering',
    targetCompany: 'TechVenture Inc',
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  },
  call2: {
    aboutMe1: 'I lead with a bias toward innovation, building engineering cultures that deliver at scale.',
    aboutMe2: 'With two decades of enterprise leadership, I have driven digital transformation for Fortune 500 organizations across cloud, SaaS, and data-intensive platforms.',
    executiveProfile: 'Technology executive driving enterprise digital transformation through cloud-native platforms, engineering excellence, and strategic leadership.',
    coverLetter: 'Dear Hiring Manager, TechVenture Inc represents exactly the kind of transformational challenge I have built my career around...',
    coldEmail: 'Hi [Name], I noticed the VP of Engineering role at TechVenture Inc and believe my background aligns well with your needs.'
  },
  call3: {
    finalSkills1: ['Enterprise Architecture', 'Cloud Strategy', 'DevSecOps'],
    finalSkills2: ['Agile Transformation', 'SaaS Platforms', 'M&A Integration'],
    finalRelevant1: 'Agile Portfolio Mgmt',
    finalRelevant2: 'SaaS Platforms',
    finalRelevant3: 'Data Governance',
    updatedResumeSummary: 'Visionary technology executive with 20+ years driving digital transformation and delivering cloud-native enterprise SaaS platforms at scale.',
    jobscanQcTable: 'Keyword matches: 85% | ATS score: 92/100'
  }
}

export function assemblePackage(call1: any, call2: any, call3: any): Record<string, string | null> {
  return {
    ResumeSummary: call3.updatedResumeSummary || call1.resumeSummary || null,
    SkillsBullets1: Array.isArray(call3.finalSkills1) ? call3.finalSkills1.join('\n') : (call1.skills1 || null),
    SkillsBullets2: Array.isArray(call3.finalSkills2) ? call3.finalSkills2.join('\n') : (call1.skills2 || null),
    ExpertiseBullets: call1.expertise || null,
    WorkHistoryBullets1: call1.workHistory1 || null,
    WorkHistoryBullets2: call1.workHistory2 || null,
    WorkHistoryBullets3: call1.workHistory3 || null,
    WorkHistoryBullets4: call1.workHistory4 || null,
    RelevantBullets1: call3.finalRelevant1 || call1.relevant1 || null,
    RelevantBullets2: call3.finalRelevant2 || call1.relevant2 || null,
    RelevantBullets3: call3.finalRelevant3 || call1.relevant3 || null,
    '@Company': call1.targetCompany || null,
    '@CoverLetterDate': call1.date || null,
    '@CoverLetterBody': call2.coverLetter || call1.coverLetter || null,
    '@AboutMe1_50words': call2.aboutMe1 || call1.aboutMe1 || null,
    '@AboutMe2_60words': call2.aboutMe2 || call1.aboutMe2 || null,
    '@ExecutiveProfile_55words': call2.executiveProfile || call1.executiveProfile || null,
    '@CoreAccomplishments_5blts_180words': call1.coreAccomplishments || null,
    coldEmail: call2.coldEmail || null,
    targetRole: call1.targetRole || null,
    targetCompany: call1.targetCompany || null,
    date: call1.date || null,
  }
}

export async function mt17(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }

  try {
    let body: any = {}
    try { body = await req.json() } catch {}
    const call1 = body.call1 || MOCK_INPUTS.call1
    const call2 = body.call2 || MOCK_INPUTS.call2
    const call3 = body.call3 || MOCK_INPUTS.call3

    const pkg = assemblePackage(call1, call2, call3)
    const nullFields = Object.entries(pkg).filter(([, v]) => v === null).map(([k]) => k)

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: nullFields.length === 0,
        detail: nullFields.length === 0 ? 'All delivery package fields assembled successfully.' : `Null fields: ${nullFields.join(', ')}`,
        package: pkg
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt17', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-17', handler: mt17 })
