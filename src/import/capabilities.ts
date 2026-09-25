import type { CapabilityDef, CapabilityL1 } from '../model/types';
import { normalizeText, similarity } from './mapping';

const L1_SYNONYMS: Record<CapabilityL1, string[]> = {
  Finance: ['finance', 'finans', 'okonomi', 'okonomiavdeling', 'regnskap', 'accounting', 'controlling', 'cfo', 'treasury'],
  HR: ['hr', 'human resources', 'personal', 'personalavdeling', 'people', 'hr lonn', 'lonn'],
  'Sales & CRM': ['sales', 'salg', 'crm', 'marketing', 'marked', 'kundeservice', 'customer service', 'commercial', 'salg og marked', 'sales marketing'],
  'Supply Chain': ['supply chain', 'scm', 'logistics', 'logistikk', 'innkjop', 'procurement', 'purchasing', 'lager', 'warehouse', 'forsyningskjede'],
  'Production/OT': ['production', 'produksjon', 'ot', 'manufacturing', 'operations', 'drift produksjon', 'fabrikk', 'plant', 'kvalitet', 'quality', 'engineering', 'teknisk', 'vedlikehold', 'maintenance', 'hms', 'hse'],
  'Data & Analytics': ['data', 'analytics', 'bi', 'data analytics', 'analyse', 'rapportering', 'reporting', 'data og analyse'],
  Collaboration: ['collaboration', 'samhandling', 'kommunikasjon', 'communication', 'office', 'workplace', 'digital arbeidsplass', 'kontorstotte'],
  'IT/Security': ['it', 'it security', 'security', 'sikkerhet', 'infrastructure', 'infrastruktur', 'it drift', 'it avdeling', 'it sikkerhet', 'cio'],
};

/** Keywords per demo capability id (English + Norwegian) used to place free-text capabilities on the map. */
const L2_KEYWORDS: Record<string, string[]> = {
  'FIN-ERP': ['erp', 'regnskap', 'hovedbok', 'general ledger', 'accounting', 'okonomisystem', 'finance system', 'gl'],
  'FIN-AP': ['faktura', 'fakturabehandling', 'invoice', 'invoicing', 'accounts payable', 'leverandorreskontro', 'ap', 'inngaende faktura', 'credit', 'kreditt'],
  'FIN-TRE': ['treasury', 'cash management', 'likviditet', 'bank', 'betaling', 'payments'],
  'FIN-FPA': ['budget', 'budsjett', 'planning', 'planlegging okonomi', 'forecast', 'prognose', 'konsolidering', 'consolidation', 'fp a'],
  'FIN-EXP': ['expense', 'reise', 'reiseregning', 'utlegg', 'travel', 'travel expense'],
  'HR-CORE': ['payroll', 'lonn', 'core hr', 'hr system', 'personalsystem', 'hris', 'personal'],
  'HR-REC': ['recruiting', 'rekruttering', 'onboarding', 'ats', 'hiring'],
  'HR-LMS': ['learning', 'laering', 'kurs', 'opplaering', 'lms', 'competence', 'kompetanse', 'training'],
  'HR-TIME': ['time', 'timeforing', 'timer', 'attendance', 'tidsregistrering', 'arbeidstid', 'turnus', 'skift', 'shift', 'time attendance'],
  'SAL-CRM': ['crm', 'customer relationship', 'kunde', 'kunder', 'kundeoppfolging', 'sales', 'salg', 'leads', 'nokkelkunder'],
  'SAL-CPQ': ['cpq', 'quote', 'quoting', 'tilbud', 'pricing', 'prising', 'configurator', 'konfigurator'],
  'SAL-SVC': ['service', 'field service', 'kundeservice', 'ettermarked', 'aftermarket', 'support', 'helpdesk kunde'],
  'SAL-WEB': ['ecommerce', 'e commerce', 'nettbutikk', 'webshop', 'dealer portal', 'forhandlerportal', 'portal', 'web', 'nettside'],
  'SCM-PRO': ['procurement', 'innkjop', 'purchasing', 'supplier', 'leverandor', 'sourcing', 'anskaffelse'],
  'SCM-WMS': ['warehouse', 'lager', 'lagerstyring', 'wms', 'inventory', 'beholdning'],
  'SCM-TMS': ['transport', 'logistics', 'logistikk', 'shipping', 'frakt', 'toll', 'customs', 'tms', 'edi'],
  'SCM-DP': ['demand planning', 'supply planning', 'etterspørsel', 'ettersporsel', 'mrp', 'produksjonsplanlegging', 'planning', 'planlegging'],
  'OT-MES': ['mes', 'manufacturing execution', 'produksjon', 'production', 'produksjonsstyring', 'shop floor'],
  'OT-EAM': ['maintenance', 'vedlikehold', 'eam', 'asset', 'cmms', 'anlegg'],
  'OT-QMS': ['quality', 'kvalitet', 'kvalitetsstyring', 'qms', 'avvik', 'lab', 'laboratorium', 'lims', 'non conformance'],
  'OT-SCADA': ['scada', 'process control', 'prosesskontroll', 'historian', 'plc', 'automation', 'automasjon'],
  'OT-PLM': ['plm', 'pdm', 'cad', 'engineering', 'produktdata', 'product data', 'tegning', 'drawings'],
  'OT-HSE': ['hse', 'hms', 'safety', 'sikkerhet hms', 'environment', 'miljo', 'baerekraft', 'esg', 'sustainability'],
  'DA-BI': ['bi', 'business intelligence', 'reporting', 'rapportering', 'rapport', 'dashboard', 'analyse', 'analytics'],
  'DA-DWH': ['data warehouse', 'datavarehus', 'dwh', 'data platform', 'dataplattform', 'lakehouse', 'data lake'],
  'DA-ETL': ['etl', 'data integration', 'dataintegrasjon', 'elt'],
  'DA-ADV': ['machine learning', 'ml', 'ai', 'advanced analytics', 'data science', 'prediksjon'],
  'COL-EMAIL': ['email', 'e post', 'epost', 'mail', 'office', 'productivity', 'kontorstotte'],
  'COL-DMS': ['document', 'dokument', 'dokumenthandtering', 'arkiv', 'archive', 'records', 'dms', 'ecm'],
  'COL-INTRA': ['intranet', 'intranett', 'internal communication', 'internkommunikasjon', 'nyheter'],
  'COL-PM': ['project', 'prosjekt', 'prosjektstyring', 'task', 'oppgave', 'work management', 'kanban'],
  'IT-IAM': ['identity', 'iam', 'tilgang', 'tilgangsstyring', 'access management', 'sso', 'active directory', 'ad', 'identitet'],
  'IT-ITSM': ['itsm', 'service desk', 'servicedesk', 'helpdesk', 'ticket', 'sak', 'saksbehandling it'],
  'IT-INT': ['integration', 'integrasjon', 'middleware', 'esb', 'api', 'ipaas', 'mellomvare'],
  'IT-SEC': ['security', 'sikkerhet', 'siem', 'antivirus', 'endpoint', 'firewall', 'brannmur', 'awareness'],
  'IT-INFRA': ['infrastructure', 'infrastruktur', 'backup', 'monitoring', 'overvaking', 'server', 'network', 'nettverk'],
};

export function matchL1(raw: string): CapabilityL1 | null {
  const n = normalizeText(raw);
  if (!n) return null;
  let best: { l1: CapabilityL1; score: number } | null = null;
  for (const [l1, syns] of Object.entries(L1_SYNONYMS) as [CapabilityL1, string[]][]) {
    for (const s of [normalizeText(l1), ...syns]) {
      const score = n === s ? 1 : ` ${n} `.includes(` ${s} `) ? 0.8 : similarity(n, s) >= 0.85 ? 0.7 : 0;
      if (score && (!best || score > best.score)) best = { l1, score };
    }
  }
  return best?.l1 ?? null;
}

export interface CapabilityMatch {
  def: CapabilityDef;
  how: 'exact' | 'keyword' | 'fuzzy';
}

/**
 * Places a free-text L2 on the reference map. Keyword hits are scored by length (specific beats generic) and
 * get a bonus when the L1 agrees, so "Lønn" under HR lands on Core HR & Payroll.
 */
export function matchL2(rawL2: string, l1: CapabilityL1 | null, catalog: CapabilityDef[]): CapabilityMatch | null {
  const n = normalizeText(rawL2);
  if (!n) return null;
  const exact = catalog.find((c) => normalizeText(c.l2) === n || c.id.toLowerCase() === rawL2.trim().toLowerCase());
  if (exact) return { def: exact, how: 'exact' };
  let best: { def: CapabilityDef; score: number; how: CapabilityMatch['how'] } | null = null;
  for (const c of catalog) {
    const bonus = l1 && c.l1 === l1 ? 0.5 : 0;
    for (const k of [...(L2_KEYWORDS[c.id] ?? []), normalizeText(c.l2)]) {
      let score = 0;
      let how: CapabilityMatch['how'] = 'keyword';
      if (` ${n} `.includes(` ${k} `)) score = 1 + k.length / 20;
      else if (n.split(' ').some((t) => t.length >= 5 && k.length >= 4 && t.startsWith(k))) score = 0.8 + k.length / 20;
      else if (similarity(n, k) >= 0.8) [score, how] = [0.7, 'fuzzy'];
      if (score && score + bonus > (best?.score ?? 0)) best = { def: c, score: score + bonus, how };
    }
  }
  return best ? { def: best.def, how: best.how } : null;
}
