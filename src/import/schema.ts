// Import targets: flat, CSV-friendly fields that build.ts turns into a System.

export type FieldGroup = 'Identity' | 'Capability' | 'Classification' | 'Lifecycle' | 'Scores' | 'Cost' | 'Relations';
export type FieldKind = 'text' | 'number' | 'year' | 'score' | 'money' | 'enum' | 'bool' | 'list';

export interface TargetField {
  key: string;
  label: string;
  group: FieldGroup;
  kind: FieldKind;
  /** What happens when the column is missing; shown in the mapping UI and written to the audit trail. */
  defaultText: string;
  example: string;
  /** Header phrases (any language) that identify the field; compared after normalisation. */
  synonyms: string[];
  /** Header words that veto this field, e.g. "cost centre" is not a cost. */
  exclude?: string[];
}

export const TARGET_FIELDS: TargetField[] = [
  { key: 'externalId', label: 'Source id', group: 'Identity', kind: 'text', defaultText: 'Generated (IMP-001…)', example: 'APP-0042',
    synonyms: ['id', 'app id', 'application id', 'system id', 'sys id', 'ci id', 'cmdb id', 'asset id', 'apm id', 'nr', 'nummer', 'system nr', 'ref'] },
  { key: 'name', label: 'System name', group: 'Identity', kind: 'text', defaultText: 'Required', example: 'Visma Lønn',
    synonyms: ['name', 'app name', 'application', 'application name', 'app', 'system', 'system name', 'systemnavn', 'applikasjon', 'applikasjonsnavn', 'navn', 'tjeneste', 'service name', 'product', 'produkt', 'løsning', 'ci name'],
    exclude: ['owner', 'eier', 'vendor', 'leverandor', 'id', 'type', 'platform', 'plattform'] },
  { key: 'vendor', label: 'Vendor', group: 'Identity', kind: 'text', defaultText: '"Unknown"', example: 'Visma',
    synonyms: ['vendor', 'supplier', 'manufacturer', 'leverandor', 'leverandør', 'produsent', 'publisher', 'provider'] },
  { key: 'description', label: 'Description', group: 'Identity', kind: 'text', defaultText: 'Empty', example: 'Payroll for Norwegian entities',
    synonyms: ['description', 'desc', 'beskrivelse', 'purpose', 'formål', 'formal', 'summary', 'details', 'funksjon'] },

  { key: 'capabilityL1', label: 'Capability L1 (domain)', group: 'Capability', kind: 'text', defaultText: 'From L2 match, else "Unclassified"', example: 'Finance',
    synonyms: ['capability l1', 'l1', 'domain', 'domene', 'business domain', 'business area', 'forretningsområde', 'owner dept', 'owner department', 'department', 'avdeling', 'business unit', 'function', 'funksjonsområde', 'area', 'område', 'eier avdeling', 'eieravdeling'] },
  { key: 'capabilityL2', label: 'Capability L2', group: 'Capability', kind: 'text', defaultText: '"Other"; new capability', example: 'Core HR & Payroll',
    synonyms: ['capability', 'capability l2', 'l2', 'business capability', 'kapabilitet', 'forretningskapabilitet', 'category', 'kategori', 'process', 'prosess', 'use case', 'bruksområde', 'sub domain', 'subdomain'] },

  { key: 'origin', label: 'Origin', group: 'Classification', kind: 'enum', defaultText: 'core', example: 'core / acquired / shadow IT',
    synonyms: ['origin', 'opphav', 'source', 'kilde', 'legal entity', 'selskap', 'company', 'entity', 'managed by', 'forvaltet av', 'it managed'] },
  { key: 'type', label: 'Type', group: 'Classification', kind: 'enum', defaultText: 'From hosting/vendor (SaaS → saas, in-house → custom, else cots)', example: 'SaaS / COTS / Custom',
    synonyms: ['type', 'app type', 'application type', 'system type', 'systemtype', 'sourcing', 'build buy', 'software type', 'lisenstype', 'type saas cots custom'] },
  { key: 'hosting', label: 'Hosting', group: 'Classification', kind: 'enum', defaultText: 'From type (SaaS → saas), else on_prem_dc', example: 'SaaS / On-prem / Azure',
    synonyms: ['hosting', 'hosted', 'deployment', 'deployment model', 'driftsmodell', 'drift', 'plassering', 'location', 'lokasjon', 'hosting model', 'infrastructure', 'infrastruktur', 'datasenter', 'data center', 'where hosted', 'kjøremiljø'] },
  { key: 'techStack', label: 'Platform / tech stack', group: 'Classification', kind: 'list', defaultText: '"Unknown"', example: 'Windows Server 2012 R2; SQL Server 2014',
    synonyms: ['tech stack', 'technology', 'teknologi', 'platform', 'plattform', 'os', 'operating system', 'operativsystem', 'stack', 'database', 'runtime', 'platform os'] },
  { key: 'dataSensitivity', label: 'Data sensitivity', group: 'Classification', kind: 'enum', defaultText: 'internal', example: 'public / internal / personal / special category',
    synonyms: ['data sensitivity', 'sensitivity', 'classification', 'data classification', 'dataklassifisering', 'klassifisering', 'personal data', 'persondata', 'personopplysninger', 'gdpr', 'konfidensialitet', 'confidentiality'] },
  { key: 'residencyRequired', label: 'Residency required', group: 'Classification', kind: 'bool', defaultText: 'Yes if special-category data, else no', example: 'yes / no',
    synonyms: ['residency', 'data residency', 'dataresidens', 'eu only', 'must stay in eu', 'lagring i norge', 'datalokasjon', 'data location'] },
  { key: 'siteBound', label: 'Site-bound (plant/OT)', group: 'Classification', kind: 'bool', defaultText: 'Yes if hosting says plant/site, else no', example: 'yes / no',
    synonyms: ['site bound', 'plant', 'fabrikk', 'ot', 'on site', 'lokal installasjon', 'edge'] },

  { key: 'platformEolYear', label: 'Platform EOL year', group: 'Lifecycle', kind: 'year', defaultText: 'None (vendor-managed or unknown: no EOL penalty)', example: '2027',
    synonyms: ['eol', 'end of life', 'end of support', 'eos', 'support end', 'support ends', 'platform eol', 'eol year', 'slutt på support', 'support utløper', 'utløp support', 'end of maintenance'] },
  { key: 'lastMajorUpgrade', label: 'Last major upgrade', group: 'Lifecycle', kind: 'year', defaultText: 'Reference year', example: '2019',
    synonyms: ['last upgrade', 'last major upgrade', 'upgraded', 'sist oppgradert', 'siste oppgradering', 'version date', 'last release', 'go live', 'installed', 'implementert'] },
  { key: 'users', label: 'Users', group: 'Lifecycle', kind: 'number', defaultText: '0 (unknown)', example: '350',
    synonyms: ['users', 'user count', 'number of users', 'brukere', 'antall brukere', 'active users', 'aktive brukere', 'seats', 'licenses in use'] },
  { key: 'sizeClass', label: 'Size class', group: 'Lifecycle', kind: 'enum', defaultText: 'From annual cost (< 1M S, < 5M M, < 15M L, else XL)', example: 'S / M / L / XL',
    synonyms: ['size', 'size class', 'størrelse', 'kompleksitet', 'complexity', 't shirt size', 'tshirt'] },

  { key: 'businessCriticality', label: 'Business criticality', group: 'Scores', kind: 'score', defaultText: '3 (neutral)', example: '1–5, 1–10, or low/medium/high',
    synonyms: ['criticality', 'business criticality', 'kritikalitet', 'kritisk', 'forretningskritikalitet', 'importance', 'viktighet', 'tier', 'service tier', 'priority', 'prioritet', 'bia'] },
  { key: 'businessFit', label: 'Business fit (overall)', group: 'Scores', kind: 'score', defaultText: 'Sub-scores or 3 (neutral)', example: '1–5',
    synonyms: ['business fit', 'business value', 'forretningsverdi', 'business score', 'functional fit', 'fit for purpose', 'forretningsmessig egnethet', 'verdi'] },
  { key: 'functionalCoverage', label: 'Functional coverage', group: 'Scores', kind: 'score', defaultText: 'Business fit or 3', example: '1–5',
    synonyms: ['functional coverage', 'functionality', 'funksjonell dekning', 'funksjonalitet', 'coverage'] },
  { key: 'userSatisfaction', label: 'User satisfaction', group: 'Scores', kind: 'score', defaultText: 'Business fit or 3', example: '1–5',
    synonyms: ['user satisfaction', 'satisfaction', 'brukertilfredshet', 'tilfredshet', 'nps', 'csat', 'user rating'] },
  { key: 'strategicRelevance', label: 'Strategic relevance', group: 'Scores', kind: 'score', defaultText: 'Business fit or 3', example: '1–5',
    synonyms: ['strategic relevance', 'strategic fit', 'strategisk relevans', 'strategisk', 'strategy', 'strategic'] },
  { key: 'technicalFit', label: 'Technical fit (overall)', group: 'Scores', kind: 'score', defaultText: 'Sub-scores or 3 (neutral)', example: '1–5',
    synonyms: ['technical fit', 'technical health', 'tech health', 'teknisk helse', 'teknisk tilstand', 'technical score', 'technical quality', 'teknisk kvalitet', 'teknisk egnethet', 'health'] },
  { key: 'supportability', label: 'Supportability', group: 'Scores', kind: 'score', defaultText: 'Technical fit or 3', example: '1–5',
    synonyms: ['supportability', 'maintainability', 'vedlikeholdbarhet', 'support quality', 'kompetanse'] },
  { key: 'security', label: 'Security', group: 'Scores', kind: 'score', defaultText: 'Technical fit or 3', example: '1–5',
    synonyms: ['security', 'security score', 'sikkerhet', 'infosec', 'security rating'] },
  { key: 'scalability', label: 'Scalability', group: 'Scores', kind: 'score', defaultText: 'Technical fit or 3', example: '1–5',
    synonyms: ['scalability', 'skalerbarhet', 'performance', 'ytelse'] },
  { key: 'documentation', label: 'Documentation', group: 'Scores', kind: 'score', defaultText: 'Technical fit or 3', example: '1–5',
    synonyms: ['documentation', 'dokumentasjon', 'docs'] },
  { key: 'eolRisk', label: 'EOL risk (5 = far off)', group: 'Scores', kind: 'score', defaultText: 'From EOL year, else technical fit or 3', example: '1–5',
    synonyms: ['eol risk', 'lifecycle risk', 'livssyklusrisiko', 'obsolescence', 'obsolescence risk'] },

  { key: 'totalCost', label: 'Annual cost (total)', group: 'Cost', kind: 'money', defaultText: 'Sum of components; one cost field is required', example: '1 250 000',
    synonyms: ['annual cost', 'cost', 'total cost', 'tco', 'annual tco', 'yearly cost', 'årlig kostnad', 'arlig kostnad', 'kostnad', 'total kostnad', 'årskostnad', 'run cost', 'driftskostnad', 'cost per year', 'cost nok', 'kost', 'budget', 'budsjett'],
    exclude: ['centre', 'center', 'sted', 'licence', 'license', 'lisens', 'infra', 'infrastructure', 'support', 'fte', 'vendor', 'leverandor', 'one', 'engangs', 'migration', 'owner'] },
  { key: 'license', label: 'Licence / subscription cost', group: 'Cost', kind: 'money', defaultText: 'Share of total by type profile, else 0', example: '400 000',
    synonyms: ['license', 'licence', 'license cost', 'licence cost', 'lisens', 'lisenskostnad', 'lisenser', 'subscription', 'abonnement', 'subscription cost'] },
  { key: 'infra', label: 'Infrastructure cost', group: 'Cost', kind: 'money', defaultText: 'Share of total by type profile, else 0', example: '250 000',
    synonyms: ['infra', 'infra cost', 'infrastructure', 'infrastructure cost', 'hosting cost', 'infrastrukturkostnad', 'driftsinfrastruktur', 'server cost', 'hardware'] },
  { key: 'supportFte', label: 'Internal support cost (NOK)', group: 'Cost', kind: 'money', defaultText: 'FTE × loaded cost, share of total, else 0', example: '600 000',
    synonyms: ['internal support cost', 'support staff cost', 'intern support', 'intern driftskostnad', 'internal cost', 'personnel cost', 'personalkostnad', 'staff cost'] },
  { key: 'supportFteCount', label: 'Internal support (FTE count)', group: 'Cost', kind: 'number', defaultText: 'Not used', example: '1.5',
    synonyms: ['fte', 'support fte', 'ftes', 'årsverk', 'arsverk', 'headcount', 'internal fte', 'support headcount', 'antall årsverk'] },
  { key: 'vendorSupport', label: 'Vendor support cost', group: 'Cost', kind: 'money', defaultText: 'Share of total by type profile, else 0', example: '150 000',
    synonyms: ['vendor support', 'maintenance', 'support agreement', 'support contract', 'vedlikeholdsavtale', 'serviceavtale', 'leverandørstøtte', 'vendor cost', 'maintenance fee', 'vedlikehold'] },

  { key: 'integrations', label: 'Depends on (integrations)', group: 'Relations', kind: 'list', defaultText: 'None', example: 'SAP ECC; Visma Lønn',
    synonyms: ['integrations', 'integration', 'dependencies', 'depends on', 'integrerer med', 'integrasjoner', 'avhengigheter', 'avhenger av', 'interfaces', 'grensesnitt', 'upstream', 'data from'] },
  { key: 'duplicateGroup', label: 'Duplicate group', group: 'Relations', kind: 'text', defaultText: 'None', example: 'crm',
    synonyms: ['duplicate group', 'duplicate', 'overlap', 'overlap group', 'overlapp', 'overlappgruppe', 'overlapp gruppe', 'redundancy group', 'consolidation group', 'konsolideringsgruppe'] },
  { key: 'isPrimary', label: 'Group standard (primary)', group: 'Relations', kind: 'bool', defaultText: 'Highest criticality, then users, in the group', example: 'yes / no',
    synonyms: ['primary', 'is primary', 'standard', 'group standard', 'konsernstandard', 'target system', 'målsystem', 'strategic platform'] },
];

export const FIELD_BY_KEY = new Map(TARGET_FIELDS.map((f) => [f.key, f]));
export type FieldKey = string;

export const COST_FIELDS = ['totalCost', 'license', 'infra', 'supportFte', 'supportFteCount', 'vendorSupport'];

export type Mapping = Record<string, FieldKey | null>;

export interface MappingIssue {
  level: 'error' | 'warning';
  text: string;
}

export function validateMapping(mapping: Mapping): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const used = new Map<string, string[]>();
  for (const [header, key] of Object.entries(mapping)) {
    if (!key) continue;
    if (!FIELD_BY_KEY.has(key)) issues.push({ level: 'error', text: `"${header}" maps to unknown field ${key}.` });
    used.set(key, [...(used.get(key) ?? []), header]);
  }
  for (const [key, headers] of used)
    if (headers.length > 1) issues.push({ level: 'error', text: `${FIELD_BY_KEY.get(key)?.label ?? key} is mapped from ${headers.length} columns (${headers.join(', ')}).` });
  if (!used.has('name')) issues.push({ level: 'error', text: 'Map a column to System name.' });
  if (!COST_FIELDS.some((k) => used.has(k))) issues.push({ level: 'error', text: 'Map at least one cost column (annual total or a component).' });
  if (!used.has('capabilityL1') && !used.has('capabilityL2'))
    issues.push({ level: 'warning', text: 'No capability column: every system lands in "Unclassified", so duplicates and SaaS alternatives cannot be found.' });
  return issues;
}

const TEMPLATE_VALUES: Record<string, string> = {
  externalId: 'APP-0001', name: 'Visma Lønn', vendor: 'Visma', description: 'Payroll for the Norwegian entities',
  capabilityL1: 'HR', capabilityL2: 'Core HR & Payroll', origin: 'core', type: 'cots', hosting: 'on_prem_dc',
  techStack: 'Windows Server 2012 R2; SQL Server 2014', dataSensitivity: 'personal', residencyRequired: 'yes', siteBound: 'no',
  platformEolYear: '2023', lastMajorUpgrade: '2017', users: '25', sizeClass: 'M', businessCriticality: '5', businessFit: '',
  functionalCoverage: '4', userSatisfaction: '3', strategicRelevance: '3', technicalFit: '', supportability: '3', security: '2',
  scalability: '3', documentation: '2', eolRisk: '1', totalCost: '', license: '400000', infra: '250000', supportFte: '600000',
  supportFteCount: '', vendorSupport: '150000', integrations: 'APP-0002', duplicateGroup: 'payroll', isPrimary: 'yes',
};

/** Template CSV: header row of field keys plus one realistic example row to overwrite. */
export function templateRows(): string[][] {
  return [TARGET_FIELDS.map((f) => f.key), TARGET_FIELDS.map((f) => TEMPLATE_VALUES[f.key] ?? '')];
}
