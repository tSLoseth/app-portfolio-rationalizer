import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type {
  CapabilityDef,
  CapabilityL1,
  DataSensitivity,
  Hosting,
  Origin,
  Portfolio,
  SizeClass,
  System,
  SystemType,
} from '../src/model/types';

const SEED = 20261008;
const REFERENCE_YEAR = 2026;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
const chance = (p: number) => rand() < p;
const clampScore = (x: number) => Math.max(1, Math.min(5, Math.round(x)));

// ---- Capability map ----

const L2: Record<string, [CapabilityL1, string, boolean, string?]> = {
  'FIN-ERP': ['Finance', 'ERP & General Ledger', true, 'SAP S/4HANA Cloud, Dynamics 365 Finance'],
  'FIN-AP': ['Finance', 'Accounts Payable & Credit', true, 'Basware, Coupa'],
  'FIN-TRE': ['Finance', 'Treasury & Cash Management', true, 'Kyriba'],
  'FIN-FPA': ['Finance', 'Planning & Consolidation', true, 'SAP Group Reporting, Board'],
  'FIN-EXP': ['Finance', 'Travel & Expense', true, 'SAP Concur'],
  'HR-CORE': ['HR', 'Core HR & Payroll', true, 'SAP SuccessFactors, Visma'],
  'HR-REC': ['HR', 'Recruiting & Onboarding', true, 'Webcruiter, Teamtailor'],
  'HR-LMS': ['HR', 'Learning & Competence', true, 'Cornerstone'],
  'HR-TIME': ['HR', 'Time & Attendance', true, 'UKG Pro, Visma Time'],
  'SAL-CRM': ['Sales & CRM', 'Customer Relationship Management', true, 'Salesforce Sales Cloud'],
  'SAL-CPQ': ['Sales & CRM', 'Quoting, Pricing & Configuration', true, 'Salesforce CPQ, Tacton'],
  'SAL-SVC': ['Sales & CRM', 'Customer & Field Service', true, 'Salesforce Service Cloud'],
  'SAL-WEB': ['Sales & CRM', 'E-commerce & Dealer Portal', false],
  'SCM-PRO': ['Supply Chain', 'Procurement & Supplier Management', true, 'SAP Ariba'],
  'SCM-WMS': ['Supply Chain', 'Warehouse Management', true, 'Manhattan Active WM'],
  'SCM-TMS': ['Supply Chain', 'Transport, Customs & Logistics', true, 'nShift, Transporeon'],
  'SCM-DP': ['Supply Chain', 'Demand & Supply Planning', true, 'Kinaxis RapidResponse'],
  'OT-MES': ['Production/OT', 'Manufacturing Execution', false],
  'OT-EAM': ['Production/OT', 'Asset & Maintenance Management', true, 'IBM Maximo Application Suite (SaaS)'],
  'OT-QMS': ['Production/OT', 'Quality & Laboratory', true, 'LabWare Cloud, ETQ'],
  'OT-SCADA': ['Production/OT', 'Process Control & Historian', false],
  'OT-PLM': ['Production/OT', 'Product Lifecycle & Engineering', true, 'Teamcenter X'],
  'OT-HSE': ['Production/OT', 'Health, Safety & Environment', true, 'DNV Synergi Life'],
  'DA-BI': ['Data & Analytics', 'Business Intelligence & Reporting', true, 'Power BI'],
  'DA-DWH': ['Data & Analytics', 'Data Platform & Warehouse', true, 'Microsoft Fabric, Databricks'],
  'DA-ETL': ['Data & Analytics', 'Data Integration & ETL', true, 'Azure Data Factory'],
  'DA-ADV': ['Data & Analytics', 'Advanced Analytics & ML', false],
  'COL-EMAIL': ['Collaboration', 'Email & Productivity', true, 'Microsoft 365'],
  'COL-DMS': ['Collaboration', 'Document & Records Management', true, 'SharePoint Online'],
  'COL-INTRA': ['Collaboration', 'Intranet & Internal Communication', true, 'SharePoint Online'],
  'COL-PM': ['Collaboration', 'Project & Work Management', true, 'Jira, Planner'],
  'IT-IAM': ['IT/Security', 'Identity & Access Management', true, 'Microsoft Entra ID'],
  'IT-ITSM': ['IT/Security', 'IT Service Management', true, 'ServiceNow'],
  'IT-INT': ['IT/Security', 'Integration Middleware', true, 'Azure Integration Services'],
  'IT-SEC': ['IT/Security', 'Security & Access Control', true, 'Microsoft Defender'],
  'IT-INFRA': ['IT/Security', 'Infrastructure, Backup & Monitoring', true, 'Azure Monitor, Veeam Cloud'],
};
type L2Key = keyof typeof L2;

// ---- Platform stacks (EOL = earliest end of vendor extended support among OS/DB/platform) ----

interface Stack {
  techStack: string[];
  eol: number | null;
  eolRiskIfManaged?: number;
  upgrade: [number, number];
}
const STACKS = {
  saas: { techStack: ['SaaS (vendor-managed)'], eol: null, eolRiskIfManaged: 5, upgrade: [2024, 2026] },
  azpaas: { techStack: ['Azure PaaS', '.NET 8', 'Azure SQL'], eol: null, eolRiskIfManaged: 5, upgrade: [2023, 2026] },
  aks: { techStack: ['Azure Kubernetes Service', 'Python 3.12', 'PostgreSQL 16'], eol: null, eolRiskIfManaged: 5, upgrade: [2024, 2026] },
  powerplatform: { techStack: ['Microsoft Power Apps', 'Dataverse'], eol: null, eolRiskIfManaged: 4, upgrade: [2023, 2025] },
  excel: { techStack: ['Microsoft Excel', 'VBA macros'], eol: null, eolRiskIfManaged: 3, upgrade: [2016, 2022] },
  appliance: { techStack: ['Vendor appliance (PAN-OS)'], eol: null, eolRiskIfManaged: 4, upgrade: [2023, 2025] },
  sapecc: { techStack: ['SAP ECC 6.0 EhP7', 'SAP NetWeaver ABAP 7.40', 'Oracle Database 19c', 'SUSE Linux Enterprise 12'], eol: 2027, upgrade: [2015, 2017] },
  sapbw: { techStack: ['SAP BW 7.5', 'SAP NetWeaver 7.50', 'Oracle Database 19c'], eol: 2027, upgrade: [2016, 2018] },
  sapbo42: { techStack: ['SAP BusinessObjects BI 4.2', 'Windows Server 2016'], eol: 2024, upgrade: [2016, 2018] },
  ws08vb6: { techStack: ['Windows Server 2008 R2', 'Visual Basic 6', 'SQL Server 2008 R2'], eol: 2020, upgrade: [2006, 2011] },
  ws12: { techStack: ['Windows Server 2012 R2'], eol: 2023, upgrade: [2013, 2016] },
  ws12net35: { techStack: ['Windows Server 2012 R2', '.NET Framework 3.5', 'SQL Server 2014'], eol: 2023, upgrade: [2010, 2015] },
  ws12sql12: { techStack: ['Windows Server 2012 R2', 'SQL Server 2012'], eol: 2022, upgrade: [2013, 2016] },
  ws12ora11: { techStack: ['Windows Server 2012 R2', 'Delphi 7', 'Oracle Database 11g R2'], eol: 2020, upgrade: [2008, 2013] },
  ws12ora11cots: { techStack: ['Windows Server 2012 R2', 'Oracle Database 11g R2'], eol: 2020, upgrade: [2013, 2015] },
  as400: { techStack: ['IBM i 7.2', 'RPG IV', 'COBOL', 'Db2 for i'], eol: 2021, upgrade: [2009, 2014] },
  biztalk13: { techStack: ['BizTalk Server 2013 R2', 'Windows Server 2012 R2', 'SQL Server 2014'], eol: 2023, upgrade: [2014, 2016] },
  sp2013: { techStack: ['SharePoint Server 2013', 'Windows Server 2012 R2'], eol: 2023, upgrade: [2013, 2015] },
  exch2013: { techStack: ['Exchange Server 2013', 'Windows Server 2012 R2'], eol: 2023, upgrade: [2014, 2016] },
  notes9: { techStack: ['HCL Notes/Domino 9.0.1', 'Windows Server 2012 R2'], eol: 2023, upgrade: [2012, 2015] },
  access: { techStack: ['Microsoft Access 2010', 'File share'], eol: 2020, upgrade: [2010, 2014] },
  py27: { techStack: ['Python 2.7 scripts', 'Windows Server 2012 R2'], eol: 2020, upgrade: [2014, 2017] },
  rserver: { techStack: ['R 3.6', 'Windows Server 2012 R2'], eol: 2023, upgrade: [2016, 2019] },
  php74: { techStack: ['WordPress', 'PHP 7.4', 'MySQL 5.7'], eol: 2022, upgrade: [2019, 2021] },
  wince: { techStack: ['Windows Embedded Compact 7', '.NET Compact Framework 3.5'], eol: 2021, upgrade: [2011, 2014] },
  vsphere67: { techStack: ['VMware vSphere 6.7', 'Dell PowerEdge R740'], eol: 2022, upgrade: [2018, 2019] },
  citrix715: { techStack: ['Citrix Virtual Apps 7.15 LTSR', 'Windows Server 2016'], eol: 2022, upgrade: [2017, 2018] },
  win7emb: { techStack: ['Windows Embedded Standard 7', 'Siemens WinCC 7.3'], eol: 2020, upgrade: [2012, 2014] },
  win10ltsc: { techStack: ['Windows 10 Enterprise LTSC 2019', 'SCADA runtime'], eol: 2029, upgrade: [2019, 2021] },
  ws16base: { techStack: ['Windows Server 2016'], eol: 2027, upgrade: [2017, 2019] },
  ws16cots: { techStack: ['Windows Server 2016', 'SQL Server 2017'], eol: 2027, upgrade: [2017, 2020] },
  ws16net48: { techStack: ['Windows Server 2016', '.NET Framework 4.8', 'SQL Server 2017'], eol: 2027, upgrade: [2017, 2020] },
  ws19cots: { techStack: ['Windows Server 2019', 'SQL Server 2019'], eol: 2029, upgrade: [2020, 2023] },
  qlikwin: { techStack: ['Qlik Sense Enterprise on Windows', 'Windows Server 2019'], eol: 2029, upgrade: [2021, 2023] },
  rhel7java8: { techStack: ['RHEL 7', 'Java 8', 'Oracle Database 12c'], eol: 2024, upgrade: [2015, 2018] },
  rhel7: { techStack: ['RHEL 7'], eol: 2024, upgrade: [2016, 2018] },
  rhel8cots: { techStack: ['RHEL 8', 'PostgreSQL 13'], eol: 2029, upgrade: [2021, 2024] },
} satisfies Record<string, Stack>;
type StackKey = keyof typeof STACKS;

// ---- Hand-curated inventory; numbers are generated from the seed ----

type Profile = 'invest' | 'legacy' | 'eliminate' | 'tolerate' | 'mixed' | 'shadow' | 'duplicate';
type O = 'C' | 'A' | 'B' | 'S';
type T = 'cu' | 'co' | 'sa';
type H = 'dc' | 'pc' | 'sa' | 'pu';
type Sens = 'pub' | 'int' | 'per' | 'spc';

interface Row {
  key: string;
  name: string;
  vendor: string;
  l2: L2Key;
  o: O;
  t: T;
  h: H;
  stack: StackKey;
  size: SizeClass;
  crit: number;
  users: number;
  sens: Sens;
  profile: Profile;
  desc: string;
  dup?: string;
  primary?: boolean;
  site?: boolean;
  cost?: number;
}

const rows: Row[] = [];
function r(
  key: string, name: string, vendor: string, l2: L2Key, o: O, t: T, h: H, stack: StackKey,
  size: SizeClass, crit: number, users: number, sens: Sens, profile: Profile, desc: string,
  extra: Partial<Pick<Row, 'dup' | 'primary' | 'site' | 'cost'>> = {},
) {
  rows.push({ key, name, vendor, l2, o, t, h, stack, size, crit, users, sens, profile, desc, ...extra });
}

// IT/Security hubs first so that generated dependencies can point "backwards" (keeps the graph acyclic).
r('ad', 'Active Directory (nordlys.local)', 'Microsoft', 'IT-IAM', 'C', 'co', 'dc', 'ws16base', 'M', 5, 4400, 'per', 'mixed', 'On-prem directory and Kerberos authentication for all domain-joined servers and clients.', { dup: 'dup-ad', primary: true });
r('entra', 'Microsoft Entra ID', 'Microsoft', 'IT-IAM', 'C', 'sa', 'sa', 'saas', 'M', 5, 4400, 'per', 'invest', 'Cloud identity, SSO and MFA; synchronised from nordlys.local AD.');
r('ad-a', 'Active Directory (vestfjord.local)', 'Microsoft', 'IT-IAM', 'A', 'co', 'dc', 'ws12', 'S', 4, 950, 'per', 'duplicate', 'Separate AD forest kept after the Vestfjord acquisition; one-way trust only.', { dup: 'dup-ad' });
r('ad-b', 'Active Directory (polar.local)', 'Microsoft', 'IT-IAM', 'B', 'co', 'dc', 'ws12', 'S', 4, 520, 'per', 'duplicate', 'Polarkomponent AD forest, not yet consolidated.', { dup: 'dup-ad' });
r('pam', 'CyberArk Privileged Access', 'CyberArk', 'IT-IAM', 'C', 'co', 'dc', 'ws19cots', 'M', 4, 60, 'int', 'invest', 'Vault and session management for admin and service accounts.');
r('po', 'SAP PI/PO 7.5', 'SAP', 'IT-INT', 'C', 'co', 'dc', 'sapecc', 'L', 5, 6, 'int', 'legacy', 'SAP-centric middleware for IDoc and EDI flows to and from ECC.', { dup: 'dup-int' });
r('biztalk', 'Microsoft BizTalk Server 2013 R2', 'Microsoft', 'IT-INT', 'C', 'co', 'dc', 'biztalk13', 'L', 5, 8, 'int', 'legacy', 'Integration hub for non-SAP systems; ~140 orchestrations, few people left who know them.', { dup: 'dup-int' });
r('ais', 'Azure Integration Services (Logic Apps, Service Bus)', 'Microsoft', 'IT-INT', 'C', 'co', 'pu', 'azpaas', 'M', 4, 6, 'int', 'invest', 'Target integration platform; first flows live since 2024.', { dup: 'dup-int', primary: true });
r('lobster', 'Lobster_data EDI (Polarkomponent)', 'Lobster', 'IT-INT', 'B', 'co', 'pc', 'ws19cots', 'S', 3, 4, 'int', 'duplicate', 'EDI translation for Swedish customers and carriers.', { dup: 'dup-int' });
r('sftp','SFTP-server for EDI (filoverføring)', 'In-house (OpenSSH on Windows)', 'IT-INT', 'C', 'co', 'dc', 'ws12', 'S', 4, 5, 'int', 'legacy', 'File-based EDI exchange with banks, carriers and key suppliers.');
r('erp', 'SAP ECC 6.0 (Nordlys core)', 'SAP', 'FIN-ERP', 'C', 'co', 'dc', 'sapecc', 'XL', 5, 1400, 'per', 'legacy', 'Group ERP: finance, logistics, sales order management and production planning for core and Polarkomponent.', { dup: 'dup-erp', primary: true, cost: 15_200_000 });
r('nav', 'Microsoft Dynamics NAV 2016 (Vestfjord)', 'Microsoft', 'FIN-ERP', 'A', 'co', 'dc', 'ws12sql12', 'L', 4, 260, 'per', 'duplicate', 'Vestfjord ERP kept after acquisition; monthly consolidation into SAP via file export.', { dup: 'dup-erp' });

// Finance
r('saft', 'SAF-T og MVA-eksport (egenutviklet)', 'In-house', 'FIN-ERP', 'C', 'cu', 'dc', 'ws16net48', 'S', 4, 8, 'int', 'mixed', 'Builds SAF-T files and VAT reporting extracts from SAP for the tax authorities.');
r('fixedassets', 'Anleggsmiddelregister (Access)', 'Microsoft Access', 'FIN-ERP', 'S', 'cu', 'dc', 'access', 'S', 3, 6, 'int', 'shadow', 'Fixed-asset register kept by group accounting outside SAP.');
r('basware', 'Basware P2P (fakturamottak)', 'Basware', 'FIN-AP', 'C', 'sa', 'sa', 'saas', 'M', 4, 350, 'int', 'invest', 'Invoice capture, matching and approval workflow.', { dup: 'dup-ap', primary: true });
r('kofax', 'Kofax fakturaskanning (Vestfjord)', 'Tungsten Automation (Kofax)', 'FIN-AP', 'A', 'co', 'dc', 'ws12sql12', 'S', 2, 25, 'int', 'eliminate', 'OCR scanning of supplier invoices into NAV.', { dup: 'dup-ap' });
r('credit', 'Creditsafe kredittvurdering', 'Creditsafe', 'FIN-AP', 'C', 'sa', 'sa', 'saas', 'S', 2, 30, 'int', 'tolerate', 'Credit checks on new customers and suppliers.');
r('collect', 'Kredinor inkassoportal', 'Kredinor', 'FIN-AP', 'C', 'sa', 'sa', 'saas', 'S', 2, 10, 'per', 'tolerate', 'Hand-off of overdue receivables to debt collection.');
r('kyriba', 'Kyriba Treasury', 'Kyriba', 'FIN-TRE', 'C', 'sa', 'sa', 'saas', 'M', 4, 15, 'int', 'invest', 'Cash positioning, FX hedging and payment factory.');
r('bank', 'Bankintegrasjon ISO 20022 (egenutviklet)', 'In-house', 'FIN-TRE', 'C', 'cu', 'dc', 'ws16net48', 'S', 5, 10, 'int', 'mixed', 'Converts SAP payment runs to ISO 20022 pain.001 and reads camt.053 statements.');
r('bpc', 'SAP BPC 10.1 (konsolidering)', 'SAP', 'FIN-FPA', 'C', 'co', 'dc', 'ws16cots', 'L', 4, 60, 'int', 'legacy', 'Group budgeting and statutory consolidation.');
r('board', 'Board Planning (Vestfjord)', 'Board International', 'FIN-FPA', 'A', 'sa', 'sa', 'saas', 'S', 3, 30, 'int', 'tolerate', 'Rolling forecast for the Vestfjord business unit.');
r('budget-xl', 'Budsjettmodell «Budsjett2019.xlsm»', 'Microsoft (Excel/VBA)', 'FIN-FPA', 'S', 'cu', 'dc', 'excel', 'S', 3, 40, 'int', 'shadow', 'Macro-heavy budget workbook on a file share; the real source for plant budgets.');
r('concur', 'SAP Concur Expense', 'SAP Concur', 'FIN-EXP', 'C', 'sa', 'sa', 'saas', 'M', 2, 3800, 'per', 'tolerate', 'Travel booking and expense claims.', { dup: 'dup-exp', primary: true });
r('vexpense', 'Visma Expense (Polarkomponent)', 'Visma', 'FIN-EXP', 'B', 'sa', 'sa', 'saas', 'S', 2, 450, 'per', 'duplicate', 'Expense claims for Polarkomponent employees.', { dup: 'dup-exp' });

// HR
r('sf', 'SAP SuccessFactors Employee Central', 'SAP', 'HR-CORE', 'C', 'sa', 'sa', 'saas', 'L', 4, 4200, 'spc', 'invest', 'Group HR master data, org structure, absence and performance.');
r('payroll', 'Visma Lønn (Nordlys)', 'Visma', 'HR-CORE', 'C', 'co', 'dc', 'ws19cots', 'M', 5, 20, 'per', 'mixed', 'Norwegian payroll for the core business; Vestfjord still runs its own.', { dup: 'dup-payroll', primary: true });
r('hl', 'Huldt & Lillevik Lønn (Vestfjord)', 'Visma (Huldt & Lillevik)', 'HR-CORE', 'A', 'co', 'dc', 'ws12sql12', 'M', 4, 12, 'per', 'duplicate', 'Vestfjord payroll, never migrated.', { dup: 'dup-payroll' });
r('hogia', 'Hogia Lön (Polarkomponent, SE)', 'Hogia', 'HR-CORE', 'B', 'co', 'pc', 'ws19cots', 'S', 4, 6, 'per', 'tolerate', 'Swedish payroll; different jurisdiction, so not a true duplicate.');
r('bht', 'BHT-journal (bedriftshelsetjeneste)', 'In-house', 'HR-CORE', 'C', 'cu', 'dc', 'ws12net35', 'S', 3, 8, 'spc', 'mixed', 'Occupational health records, including health assessments for shift workers.');
r('webcruiter', 'Webcruiter', 'Webcruiter', 'HR-REC', 'C', 'sa', 'sa', 'saas', 'S', 2, 120, 'per', 'tolerate', 'Recruitment and applicant tracking.', { dup: 'dup-rec', primary: true });
r('teamtailor', 'Teamtailor (Polarkomponent)', 'Teamtailor', 'HR-REC', 'B', 'sa', 'sa', 'saas', 'S', 2, 25, 'per', 'duplicate', 'Swedish recruitment site and applicant tracking.', { dup: 'dup-rec' });
r('onboard', 'Onboarding-portal (SharePoint 2013)', 'Microsoft', 'HR-REC', 'C', 'co', 'dc', 'sp2013', 'S', 2, 600, 'int', 'eliminate', 'Checklists and forms for new hires.');
r('lms', 'Cornerstone Learning', 'Cornerstone OnDemand', 'HR-LMS', 'C', 'sa', 'sa', 'saas', 'M', 3, 4000, 'per', 'tolerate', 'E-learning, mandatory HSE courses and certifications.');
r('competence', 'Kompetanseregister (Access)', 'Microsoft Access', 'HR-LMS', 'S', 'cu', 'dc', 'access', 'S', 3, 30, 'per', 'shadow', 'Welding and crane certificates per operator; used in audits.');
r('appraisal', 'Simployer medarbeidersamtaler', 'Simployer', 'HR-LMS', 'C', 'sa', 'sa', 'saas', 'S', 2, 3800, 'per', 'tolerate', 'Annual performance dialogues.');
r('ukg', 'UKG Workforce Central (tid og skift)', 'UKG', 'HR-TIME', 'C', 'co', 'dc', 'ws16cots', 'L', 4, 3200, 'per', 'legacy', 'Time clocks, shift planning and overtime feeding payroll.', { dup: 'dup-time', primary: true });
r('clock', 'Stemplingsur-integrasjon (egenutviklet)', 'In-house', 'HR-TIME', 'C', 'cu', 'dc', 'ws08vb6', 'S', 3, 5, 'int', 'eliminate', 'Polls physical time clocks and pushes punches to UKG.');
r('tripletex', 'Tripletex Timer (Vestfjord)', 'Tripletex (Visma)', 'HR-TIME', 'A', 'sa', 'sa', 'saas', 'S', 3, 800, 'per', 'duplicate', 'Hour registration for Vestfjord projects and payroll.', { dup: 'dup-time' });

// Sales & CRM
r('sfdc', 'Salesforce Sales Cloud', 'Salesforce', 'SAL-CRM', 'C', 'sa', 'sa', 'saas', 'L', 4, 420, 'per', 'invest', 'Group CRM for accounts, opportunities and key-account plans.', { dup: 'dup-crm', primary: true });
r('d365', 'Microsoft Dynamics 365 Sales (Vestfjord)', 'Microsoft', 'SAL-CRM', 'A', 'sa', 'sa', 'saas', 'M', 3, 110, 'per', 'duplicate', 'Vestfjord CRM; customers overlap ~30 % with Salesforce.', { dup: 'dup-crm' });
r('superoffice', 'SuperOffice CRM (Polarkomponent)', 'SuperOffice', 'SAL-CRM', 'B', 'co', 'pc', 'ws16cots', 'M', 3, 70, 'per', 'duplicate', 'Polarkomponent CRM hosted by a Swedish MSP.', { dup: 'dup-crm' });
r('airtable', 'Airtable «Nøkkelkunder Vest»', 'Airtable', 'SAL-CRM', 'S', 'sa', 'sa', 'saas', 'S', 2, 12, 'per', 'shadow', 'Key-account tracker built by a regional sales team; contains customer contact data.');
r('hubspot', 'HubSpot Marketing Hub', 'HubSpot', 'SAL-CRM', 'S', 'sa', 'sa', 'saas', 'S', 2, 12, 'per', 'shadow', 'Newsletter and campaign tool bought on a marketing credit card.');
r('konfig', 'KONFIG produktkonfigurator (egenutviklet)', 'In-house', 'SAL-CPQ', 'C', 'cu', 'dc', 'ws12ora11', 'L', 5, 380, 'int', 'legacy', 'Rules engine for configuring hydraulic systems; every order passes through it. Two developers know the Delphi code.');
r('cpq', 'Salesforce CPQ', 'Salesforce', 'SAL-CPQ', 'C', 'sa', 'sa', 'saas', 'M', 3, 150, 'int', 'mixed', 'Quote documents and discount approval on top of Sales Cloud; configuration still done in KONFIG.');
r('quote-xl', 'Tilbudskalkulator.xlsm (Polarkomponent)', 'Microsoft (Excel/VBA)', 'SAL-CPQ', 'S', 'cu', 'dc', 'excel', 'S', 3, 20, 'int', 'shadow', 'Quote calculator with embedded price lists.');
r('svc', 'Salesforce Service Cloud', 'Salesforce', 'SAL-SVC', 'C', 'sa', 'sa', 'saas', 'M', 3, 180, 'per', 'invest', 'Customer service cases and warranty claims.', { dup: 'dup-svc', primary: true });
r('ifsfs', 'IFS Field Service (Vestfjord)', 'IFS', 'SAL-SVC', 'A', 'co', 'dc', 'ws19cots', 'M', 3, 90, 'per', 'tolerate', 'Dispatch and work orders for field technicians.');
r('zendesk', 'Zendesk (Polarkomponent)', 'Zendesk', 'SAL-SVC', 'B', 'sa', 'sa', 'saas', 'S', 2, 30, 'per', 'duplicate', 'Support tickets for Swedish customers.', { dup: 'dup-svc' });
r('warranty', 'Garantisaker (Lotus Notes)', 'HCL (IBM) Notes', 'SAL-SVC', 'C', 'co', 'dc', 'notes9', 'S', 2, 45, 'per', 'eliminate', 'Legacy warranty database, read-only since 2021 but still consulted.');
r('puzzel', 'Puzzel kundesenter', 'Puzzel', 'SAL-SVC', 'C', 'sa', 'sa', 'saas', 'S', 3, 60, 'per', 'tolerate', 'Contact-centre telephony and chat.');
r('portal', 'Forhandlerportal Nordlys Partner (egenutviklet)', 'In-house', 'SAL-WEB', 'C', 'cu', 'dc', 'ws16net48', 'M', 4, 900, 'per', 'mixed', 'Dealer ordering, spare parts and documentation for ~300 external dealers.');
r('b2b', 'B2B-nettbutikk (Optimizely Commerce)', 'Optimizely', 'SAL-WEB', 'C', 'co', 'pu', 'azpaas', 'M', 4, 2500, 'per', 'invest', 'Online spare-parts shop for industrial customers.');
r('parts', 'Reservedelskatalog (Vestfjord)', 'In-house (Vestfjord)', 'SAL-WEB', 'A', 'cu', 'dc', 'ws12net35', 'S', 3, 400, 'pub', 'eliminate', 'Static spare-parts catalogue, largely superseded by the B2B shop.');
r('pim', 'inriver PIM', 'inriver', 'SAL-WEB', 'C', 'sa', 'sa', 'saas', 'M', 3, 45, 'int', 'invest', 'Product master data and media for web shop and dealer portal.');
r('wp', 'Kampanjesider (WordPress)', 'WordPress (self-hosted)', 'SAL-WEB', 'S', 'co', 'pu', 'php74', 'S', 1, 5, 'pub', 'shadow', 'Campaign microsites set up by an agency on a cheap VPS.');

// Supply Chain
r('ariba', 'SAP Ariba Sourcing', 'SAP', 'SCM-PRO', 'C', 'sa', 'sa', 'saas', 'M', 3, 140, 'int', 'invest', 'Sourcing events, contracts and supplier onboarding.');
r('mercell', 'Mercell TendSign', 'Mercell', 'SCM-PRO', 'C', 'sa', 'sa', 'saas', 'S', 2, 25, 'int', 'tolerate', 'Public-sector tenders the group responds to.');
r('contracts', 'Kontraktsdatabase (SharePoint 2013)', 'Microsoft', 'SCM-PRO', 'C', 'co', 'dc', 'sp2013', 'S', 2, 60, 'int', 'eliminate', 'Supplier contract repository, duplicated in Ariba since 2023.');
r('supqual', 'Leverandørkvalifisering (egenutviklet)', 'In-house', 'SCM-PRO', 'C', 'cu', 'dc', 'ws12net35', 'S', 2, 30, 'int', 'eliminate', 'Supplier audit questionnaires and scores.');
r('wms', 'Manhattan WMS (sentrallager Moss)', 'Manhattan Associates', 'SCM-WMS', 'C', 'co', 'dc', 'rhel7java8', 'L', 5, 260, 'int', 'mixed', 'Central warehouse management for finished goods and spare parts.', { dup: 'dup-wms', primary: true });
r('lx', 'Lagerstyring LX (Vestfjord, egenutviklet)', 'In-house (Vestfjord)', 'SCM-WMS', 'A', 'cu', 'dc', 'ws12net35', 'M', 4, 70, 'int', 'legacy', 'Warehouse system at the Florø plant; tightly coupled to NAV.', { dup: 'dup-wms' });
r('astro', 'Astro WMS (Polarkomponent)', 'Consafe Logistics', 'SCM-WMS', 'B', 'co', 'pc', 'ws19cots', 'M', 4, 45, 'int', 'duplicate', 'Warehouse management at the Kalmar site.', { dup: 'dup-wms' });
r('handheld', 'Håndterminal-app lager (Windows CE)', 'In-house', 'SCM-WMS', 'C', 'cu', 'dc', 'wince', 'S', 4, 120, 'int', 'legacy', 'Scanner app for picking and goods receipt; devices no longer sold.');
r('nshift', 'nShift Delivery (Consignor)', 'nShift', 'SCM-TMS', 'C', 'sa', 'sa', 'saas', 'S', 3, 110, 'per', 'tolerate', 'Carrier booking and shipping labels.');
r('freight', 'Fraktberegning (AS/400)', 'In-house', 'SCM-TMS', 'C', 'cu', 'dc', 'as400', 'S', 3, 30, 'int', 'eliminate', 'Freight cost estimation, partly replaced by nShift.');
r('transporeon', 'Transporeon transportplanlegging', 'Transporeon', 'SCM-TMS', 'C', 'sa', 'sa', 'saas', 'M', 3, 55, 'int', 'invest', 'Full-truckload tendering and dock scheduling.');
r('customs', 'Tolldeklarasjon (egenutviklet)', 'In-house', 'SCM-TMS', 'C', 'cu', 'dc', 'ws12net35', 'S', 4, 12, 'int', 'legacy', 'Export declarations to Norwegian customs; exports stop if it is down.');
r('kinaxis', 'Kinaxis RapidResponse', 'Kinaxis', 'SCM-DP', 'C', 'sa', 'sa', 'saas', 'L', 4, 80, 'int', 'invest', 'Sales and operations planning and supply scenarios.');
r('nordplan', 'NORD-PLAN produksjonsplanlegging (egenutviklet)', 'In-house', 'SCM-DP', 'C', 'cu', 'dc', 'ws12ora11', 'L', 5, 140, 'int', 'legacy', 'Finite-capacity scheduling for all Norwegian plants; written in Delphi in 2004.');
r('forecast-xl', 'Prognose-Excel (Polarkomponent)', 'Microsoft (Excel/VBA)', 'SCM-DP', 'S', 'cu', 'sa', 'excel', 'S', 2, 6, 'int', 'shadow', 'Demand forecast workbook on OneDrive.');

// Production / OT
r('opcenter', 'Siemens Opcenter Execution (Gjøvik, Sunndal)', 'Siemens', 'OT-MES', 'C', 'co', 'dc', 'ws19cots', 'XL', 5, 650, 'int', 'invest', 'MES for the two largest Norwegian plants.', { dup: 'dup-mes', primary: true, cost: 9_400_000 });
r('as400', 'Ordremottak produksjon (AS/400)', 'In-house', 'OT-MES', 'C', 'cu', 'dc', 'as400', 'L', 5, 300, 'int', 'legacy', 'Releases production orders to the shop floor and prints routing cards; RPG/COBOL from the 1990s.');
r('mesflo', 'MES Florø (Vestfjord, egenutviklet)', 'In-house (Vestfjord)', 'OT-MES', 'A', 'cu', 'dc', 'ws12net35', 'M', 4, 120, 'int', 'legacy', 'Home-grown MES at the Florø plant.', { dup: 'dup-mes' });
r('aveva-mes', 'AVEVA MES (Polarkomponent Kalmar)', 'AVEVA', 'OT-MES', 'B', 'co', 'dc', 'ws16cots', 'M', 4, 90, 'int', 'duplicate', 'MES at the Kalmar plant; runs in the plant server room.', { dup: 'dup-mes', site: true });
r('shiftapp', 'Skiftplan-app (Power Apps, Gjøvik)', 'Microsoft Power Apps', 'OT-MES', 'S', 'cu', 'sa', 'powerplatform', 'S', 2, 60, 'per', 'shadow', 'Shift swap app built by a production supervisor.');
r('labels', 'NiceLabel etikettprinting', 'Loftware (NiceLabel)', 'OT-MES', 'C', 'co', 'dc', 'ws16cots', 'S', 4, 90, 'int', 'tolerate', 'Product and pallet labels printed from MES and WMS.');
r('trace', 'Sporbarhet og serienummer (egenutviklet)', 'In-house', 'OT-MES', 'C', 'cu', 'dc', 'ws16net48', 'M', 4, 200, 'int', 'mixed', 'Serial-number genealogy required by offshore customers.');
r('maximo', 'IBM Maximo 7.6', 'IBM', 'OT-EAM', 'C', 'co', 'dc', 'rhel7java8', 'L', 4, 350, 'int', 'mixed', 'Maintenance work orders and spare parts for Norwegian plants.', { dup: 'dup-eam', primary: true });
r('ifs', 'IFS Applications 9 vedlikehold (Vestfjord)', 'IFS', 'OT-EAM', 'A', 'co', 'dc', 'ws12ora11cots', 'M', 3, 80, 'int', 'duplicate', 'Maintenance module at Florø.', { dup: 'dup-eam' });
r('lube', 'Smøreplan (Access, Sunndal)', 'Microsoft Access', 'OT-EAM', 'S', 'cu', 'dc', 'access', 'S', 2, 8, 'int', 'shadow', 'Lubrication schedule outside Maximo.');
r('lims', 'LabWare LIMS', 'LabWare', 'OT-QMS', 'C', 'co', 'dc', 'ws16cots', 'M', 4, 70, 'int', 'mixed', 'Material testing and lab results.');
r('qpulse', 'Q-Pulse avvik (Vestfjord)', 'Ideagen', 'OT-QMS', 'A', 'co', 'dc', 'ws12sql12', 'S', 2, 150, 'int', 'eliminate', 'Quality non-conformance log at Florø.');
r('spc', 'SPC-analyse (egenutviklet, Gjøvik)', 'In-house', 'OT-QMS', 'C', 'cu', 'dc', 'ws16net48', 'S', 3, 40, 'int', 'mixed', 'Statistical process control charts from machine data.');
r('cert31', 'Sertifikatgenerator 3.1 (egenutviklet)', 'In-house', 'OT-QMS', 'C', 'cu', 'dc', 'ws08vb6', 'S', 4, 50, 'int', 'legacy', 'Generates EN 10204 3.1 material certificates shipped with every order.');
r('beamex', 'Beamex CMX kalibrering', 'Beamex', 'OT-QMS', 'C', 'co', 'dc', 'ws16cots', 'S', 3, 40, 'int', 'tolerate', 'Calibration register for measuring instruments.');
r('pi', 'AVEVA PI System (historian)', 'AVEVA', 'OT-SCADA', 'C', 'co', 'dc', 'ws19cots', 'L', 5, 200, 'int', 'invest', 'Process data historian for all plants.');
r('wincc-g', 'WinCC SCADA Gjøvik', 'Siemens', 'OT-SCADA', 'C', 'co', 'dc', 'win10ltsc', 'M', 5, 40, 'int', 'tolerate', 'Process control for the Gjøvik foundry.', { site: true });
r('wincc-s', 'WinCC SCADA Sunndal', 'Siemens', 'OT-SCADA', 'C', 'co', 'dc', 'win7emb', 'M', 5, 30, 'int', 'legacy', 'Process control for Sunndal; operator stations on Windows 7 Embedded.', { site: true });
r('citect', 'Citect SCADA (Polarkomponent)', 'AVEVA (Schneider Electric)', 'OT-SCADA', 'B', 'co', 'dc', 'win10ltsc', 'M', 4, 20, 'int', 'tolerate', 'Process control at Kalmar.', { site: true });
r('pyexport', 'Prosessdata-eksport (Python-skript)', 'In-house', 'OT-SCADA', 'S', 'cu', 'dc', 'py27', 'S', 3, 10, 'int', 'shadow', 'Nightly scripts copying historian data to Excel reports; written by a summer intern.');
r('teamcenter', 'Siemens Teamcenter', 'Siemens', 'OT-PLM', 'C', 'co', 'dc', 'ws19cots', 'L', 4, 420, 'int', 'invest', 'CAD data, BOMs and engineering change management.', { dup: 'dup-plm', primary: true });
r('vault', 'Autodesk Vault (Vestfjord)', 'Autodesk', 'OT-PLM', 'A', 'co', 'dc', 'ws16cots', 'M', 3, 90, 'int', 'duplicate', 'Inventor CAD vault at Vestfjord.', { dup: 'dup-plm' });
r('swpdm', 'SolidWorks PDM (Polarkomponent)', 'Dassault Systèmes', 'OT-PLM', 'B', 'co', 'dc', 'ws16cots', 'S', 3, 45, 'int', 'duplicate', 'SolidWorks vault at Kalmar.', { dup: 'dup-plm' });
r('drawings', 'Tegningsarkiv (egenutviklet)', 'In-house', 'OT-PLM', 'C', 'cu', 'dc', 'ws08vb6', 'S', 2, 150, 'int', 'eliminate', 'Scanned legacy drawings; lookup UI in VB6.');
r('synergi', 'DNV Synergi Life', 'DNV', 'OT-HSE', 'C', 'sa', 'sa', 'saas', 'M', 4, 4000, 'per', 'invest', 'HSE incidents, risk assessments and audits.', { dup: 'dup-hse', primary: true });
r('landax', 'Landax HMS (Vestfjord)', 'Landax', 'OT-HSE', 'A', 'sa', 'sa', 'saas', 'S', 3, 800, 'per', 'duplicate', 'HSE non-conformances at Vestfjord.', { dup: 'dup-hse' });
r('ecoonline', 'EcoOnline stoffkartotek', 'EcoOnline', 'OT-HSE', 'C', 'sa', 'sa', 'saas', 'S', 3, 600, 'int', 'tolerate', 'Chemical register and safety data sheets.');
r('energy', 'EcoStruxure Resource Advisor (energi/ESG)', 'Schneider Electric', 'OT-HSE', 'C', 'sa', 'sa', 'saas', 'S', 2, 20, 'int', 'tolerate', 'Energy monitoring and CSRD emissions data.');

// Data & Analytics
r('dataplatform', 'Nordlys Dataplattform (Azure Synapse / Data Lake)', 'Microsoft', 'DA-DWH', 'C', 'cu', 'pu', 'azpaas', 'L', 4, 40, 'int', 'invest', 'Target data platform; lakehouse with SAP, CRM and MES sources.', { dup: 'dup-dwh', primary: true });
r('bw', 'SAP BW 7.5', 'SAP', 'DA-DWH', 'C', 'co', 'dc', 'sapbw', 'L', 4, 60, 'int', 'legacy', 'Financial and logistics reporting warehouse on top of ECC.');
r('dwh-a', 'Datavarehus Vestfjord (SQL Server 2012)', 'In-house (Vestfjord)', 'DA-DWH', 'A', 'cu', 'dc', 'ws12sql12', 'M', 2, 15, 'int', 'eliminate', 'Vestfjord reporting database, loaded nightly from NAV.', { dup: 'dup-dwh' });
r('adf', 'Azure Data Factory', 'Microsoft', 'DA-ETL', 'C', 'co', 'pu', 'azpaas', 'M', 3, 10, 'int', 'invest', 'Pipelines feeding the data platform.', { dup: 'dup-etl', primary: true });
r('informatica', 'Informatica PowerCenter', 'Informatica', 'DA-ETL', 'C', 'co', 'dc', 'rhel7java8', 'M', 3, 12, 'int', 'mixed', 'Legacy ETL into BW and BusinessObjects universes.', { dup: 'dup-etl' });
r('ssis', 'SSIS-pakker (Vestfjord)', 'Microsoft', 'DA-ETL', 'A', 'co', 'dc', 'ws12sql12', 'S', 2, 4, 'int', 'duplicate', 'ETL for the Vestfjord data warehouse.', { dup: 'dup-etl' });
r('powerbi', 'Microsoft Power BI', 'Microsoft', 'DA-BI', 'C', 'sa', 'sa', 'saas', 'M', 3, 1800, 'int', 'invest', 'Group-standard BI and self-service reporting.', { dup: 'dup-bi', primary: true });
r('qlik', 'Qlik Sense Enterprise (Vestfjord)', 'Qlik', 'DA-BI', 'A', 'co', 'dc', 'qlikwin', 'M', 3, 220, 'int', 'duplicate', 'Vestfjord dashboards; loved by its users.', { dup: 'dup-bi' });
r('tableau', 'Tableau Server (Polarkomponent)', 'Salesforce (Tableau)', 'DA-BI', 'B', 'co', 'pc', 'ws19cots', 'M', 3, 90, 'int', 'duplicate', 'Polarkomponent sales and production dashboards.', { dup: 'dup-bi' });
r('bo', 'SAP BusinessObjects BI 4.2', 'SAP', 'DA-BI', 'C', 'co', 'dc', 'sapbo42', 'M', 3, 500, 'int', 'legacy', 'Legacy statutory and operational reports on BW.', { dup: 'dup-bi' });
r('reports-xl', 'Rapportpakke «Månedstall» (Excel)', 'Microsoft (Excel/VBA)', 'DA-BI', 'S', 'cu', 'dc', 'excel', 'S', 3, 25, 'int', 'shadow', 'Monthly management pack assembled by controlling from BW extracts.');
r('pdm-ml', 'Prediktivt vedlikehold (Azure ML)', 'In-house', 'DA-ADV', 'C', 'cu', 'pu', 'aks', 'M', 3, 25, 'int', 'invest', 'Failure prediction for critical pumps from PI data.');
r('elasticity', 'Priselastisitetsmodell (R)', 'In-house', 'DA-ADV', 'S', 'cu', 'dc', 'rserver', 'S', 2, 4, 'int', 'shadow', 'Pricing model maintained by one analyst.');
r('sas', 'SAS 9.4 (Vestfjord analyse)', 'SAS Institute', 'DA-ADV', 'A', 'co', 'dc', 'ws16cots', 'M', 2, 15, 'int', 'eliminate', 'Statistical analysis licences, mostly unused since 2023.');
r('databricks', 'Databricks (pilot)', 'Databricks', 'DA-ADV', 'C', 'sa', 'sa', 'saas', 'S', 2, 12, 'int', 'mixed', 'Pilot workspace for data science.');

// Collaboration
r('m365', 'Microsoft 365 (Exchange Online, Teams, OneDrive)', 'Microsoft', 'COL-EMAIL', 'C', 'sa', 'sa', 'saas', 'XL', 5, 4400, 'per', 'invest', 'Email, Teams, Office apps and OneDrive for the whole group.', { dup: 'dup-email', primary: true, cost: 14_800_000 });
r('exch', 'Exchange Server 2013 (Polarkomponent)', 'Microsoft', 'COL-EMAIL', 'B', 'co', 'dc', 'exch2013', 'S', 3, 520, 'per', 'eliminate', 'Polarkomponent mailboxes, not yet migrated to Exchange Online.', { dup: 'dup-email' });
r('gws', 'Google Workspace (markedsavdelingen)', 'Google', 'COL-EMAIL', 'S', 'sa', 'sa', 'saas', 'S', 2, 35, 'per', 'shadow', 'Marketing team docs and shared drives outside M365.', { dup: 'dup-email' });
r('miro', 'Miro', 'Miro', 'COL-EMAIL', 'S', 'sa', 'sa', 'saas', 'S', 1, 180, 'int', 'shadow', 'Whiteboards; many team licences on expense claims.');
r('spo', 'SharePoint Online', 'Microsoft', 'COL-DMS', 'C', 'sa', 'sa', 'saas', 'M', 4, 4200, 'per', 'invest', 'Group document management and team sites.', { dup: 'dup-dms', primary: true });
r('mfiles', 'M-Files (Polarkomponent)', 'M-Files', 'COL-DMS', 'B', 'co', 'pc', 'ws19cots', 'S', 3, 400, 'per', 'duplicate', 'Document vault at Polarkomponent.', { dup: 'dup-dms' });
r('dropbox', 'Dropbox Business (prosjektavdelingen)', 'Dropbox', 'COL-DMS', 'S', 'sa', 'sa', 'saas', 'S', 2, 60, 'per', 'shadow', 'Project documents shared with EPC customers.', { dup: 'dup-dms' });
r('fileserver', 'Filserver nordlys-fs01', 'Microsoft (Windows file services)', 'COL-DMS', 'C', 'co', 'dc', 'ws12', 'M', 4, 3500, 'per', 'mixed', 'Departmental file shares, 38 TB, many with open permissions.');
r('documentum', 'Documentum sertifikatarkiv', 'OpenText', 'COL-DMS', 'C', 'co', 'dc', 'rhel7java8', 'M', 3, 200, 'int', 'mixed', 'Archive of quality certificates and as-built documentation.');
r('penneo', 'Penneo e-signering', 'Penneo', 'COL-DMS', 'C', 'sa', 'sa', 'saas', 'S', 2, 150, 'per', 'tolerate', 'Electronic signing of contracts.');
r('intranet', 'Intranett «Nordlyset» (SharePoint Online)', 'Microsoft', 'COL-INTRA', 'C', 'sa', 'sa', 'saas', 'S', 2, 4200, 'int', 'tolerate', 'Group intranet and news.', { dup: 'dup-intra', primary: true });
r('episerver', 'Vestfjord intranett (Episerver CMS 7)', 'Optimizely (Episerver)', 'COL-INTRA', 'A', 'co', 'dc', 'ws12net35', 'S', 1, 900, 'int', 'eliminate', 'Old Vestfjord intranet, still the home page on Florø PCs.', { dup: 'dup-intra' });
r('staffbase', 'Staffbase (Polarkomponent)', 'Staffbase', 'COL-INTRA', 'B', 'sa', 'sa', 'saas', 'S', 1, 480, 'int', 'duplicate', 'Employee app for Kalmar shop-floor workers.', { dup: 'dup-intra' });
r('canteen', 'Kantinebestilling (egenutviklet)', 'In-house', 'COL-INTRA', 'S', 'cu', 'dc', 'php74', 'S', 1, 700, 'int', 'shadow', 'Lunch ordering page built by a facilities employee.');
r('jira', 'Jira Software Cloud', 'Atlassian', 'COL-PM', 'C', 'sa', 'sa', 'saas', 'S', 3, 260, 'int', 'invest', 'Work management for IT, engineering and projects.', { dup: 'dup-pm', primary: true });
r('projectserver', 'Microsoft Project Server 2013', 'Microsoft', 'COL-PM', 'C', 'co', 'dc', 'sp2013', 'M', 3, 150, 'int', 'eliminate', 'Capital project portfolio and resource plans.', { dup: 'dup-pm' });
r('trello', 'Trello (engineering Gjøvik)', 'Atlassian', 'COL-PM', 'S', 'sa', 'sa', 'saas', 'S', 1, 40, 'int', 'shadow', 'Engineering task boards.', { dup: 'dup-pm' });
r('asana', 'Asana (markedsavdelingen)', 'Asana', 'COL-PM', 'S', 'sa', 'sa', 'saas', 'S', 1, 25, 'int', 'shadow', 'Campaign planning.', { dup: 'dup-pm' });
r('monday', 'monday.com (Polarkomponent)', 'monday.com', 'COL-PM', 'S', 'sa', 'sa', 'saas', 'S', 2, 35, 'int', 'shadow', 'Customer project tracking at Kalmar.', { dup: 'dup-pm' });

// IT/Security (non-hub)
r('snow', 'ServiceNow ITSM', 'ServiceNow', 'IT-ITSM', 'C', 'sa', 'sa', 'saas', 'L', 4, 4400, 'per', 'invest', 'Incident, request, change and CMDB.', { dup: 'dup-itsm', primary: true });
r('topdesk', 'TOPdesk (Polarkomponent)', 'TOPdesk', 'IT-ITSM', 'B', 'sa', 'sa', 'saas', 'S', 3, 520, 'per', 'duplicate', 'Service desk for Polarkomponent.', { dup: 'dup-itsm' });
r('lansweeper', 'Lansweeper IT-asset', 'Lansweeper', 'IT-ITSM', 'C', 'co', 'dc', 'ws19cots', 'S', 2, 12, 'int', 'tolerate', 'Hardware and software inventory scanning.');
r('confluence', 'Confluence Data Center', 'Atlassian', 'IT-ITSM', 'C', 'co', 'dc', 'rhel8cots', 'S', 2, 500, 'int', 'tolerate', 'IT runbooks and knowledge base.');
r('defender', 'Microsoft Defender for Endpoint', 'Microsoft', 'IT-SEC', 'C', 'sa', 'sa', 'saas', 'M', 5, 4400, 'int', 'invest', 'Endpoint detection and response.', { dup: 'dup-sec', primary: true });
r('symantec', 'Symantec Endpoint Protection (Vestfjord)', 'Broadcom', 'IT-SEC', 'A', 'co', 'dc', 'ws12sql12', 'S', 3, 950, 'int', 'duplicate', 'Antivirus on Vestfjord clients and servers.', { dup: 'dup-sec' });
r('splunk', 'Splunk Enterprise (SIEM)', 'Splunk (Cisco)', 'IT-SEC', 'C', 'co', 'dc', 'rhel8cots', 'L', 4, 15, 'int', 'invest', 'Security log collection and SOC use cases.');
r('knowbe4', 'KnowBe4 sikkerhetsopplæring', 'KnowBe4', 'IT-SEC', 'C', 'sa', 'sa', 'saas', 'S', 2, 4400, 'int', 'tolerate', 'Phishing simulation and awareness training.');
r('access', 'Adgangskontroll ASSA ARX', 'ASSA ABLOY', 'IT-SEC', 'C', 'co', 'dc', 'ws12sql12', 'S', 4, 4000, 'per', 'legacy', 'Physical access cards for all sites.');
r('vmware', 'VMware vSphere 6.7 (datasenter Nordlys)', 'Broadcom (VMware)', 'IT-INFRA', 'C', 'co', 'dc', 'vsphere67', 'L', 5, 10, 'int', 'legacy', 'Virtualisation platform hosting ~420 VMs in the leased data center.');
r('veeam', 'Veeam Backup & Replication', 'Veeam', 'IT-INFRA', 'C', 'co', 'dc', 'ws19cots', 'M', 5, 8, 'int', 'tolerate', 'Backup of all VMs to on-site disk and tape.');
r('nagios', 'Nagios XI overvåkning', 'Nagios Enterprises', 'IT-INFRA', 'C', 'co', 'dc', 'rhel7', 'S', 3, 10, 'int', 'eliminate', 'Infrastructure monitoring; alerts mostly ignored.');
r('intune', 'Microsoft Intune', 'Microsoft', 'IT-INFRA', 'C', 'sa', 'sa', 'saas', 'M', 4, 4400, 'int', 'invest', 'Device and app management for laptops and phones.');
r('papercut', 'PaperCut utskrift', 'PaperCut', 'IT-INFRA', 'C', 'co', 'dc', 'ws16cots', 'S', 2, 3800, 'int', 'tolerate', 'Follow-me printing.');
r('citrix', 'Citrix Virtual Apps 7.15 (fjerntilgang)', 'Cloud Software Group (Citrix)', 'IT-INFRA', 'C', 'co', 'dc', 'citrix715', 'M', 4, 600, 'int', 'legacy', 'Publishes KONFIG, NORD-PLAN and other fat clients to remote users.');
r('panorama', 'Palo Alto Panorama (brannmurer)', 'Palo Alto Networks', 'IT-INFRA', 'C', 'co', 'dc', 'appliance', 'M', 5, 6, 'int', 'invest', 'Central management of site firewalls.');

// ---- Planted dependency edges (dependent -> dependency). Some intentionally form cycles. ----

const plantedEdges: [string, string][] = [
  ['entra', 'ad'], ['ad-a', 'ad'], ['ad-b', 'ad'],
  ['erp', 'po'], ['po', 'erp'], // SAP ↔ PI/PO: classic bidirectional IDoc flow (cycle)
  ['erp', 'opcenter'], ['opcenter', 'erp'], // production confirmations back to ERP (cycle)
  ['sfdc', 'konfig'], ['konfig', 'sfdc'], ['cpq', 'sfdc'], ['cpq', 'konfig'], // configurator loop (cycle)
  ['wms', 'transporeon'], ['transporeon', 'wms'], // dock scheduling loop (cycle)
  ['bank', 'erp'], ['bank', 'sftp'], ['kyriba', 'bank'], ['saft', 'erp'], ['fixedassets', 'erp'],
  ['basware', 'erp'], ['kofax', 'nav'], ['bpc', 'erp'], ['bpc', 'bw'], ['board', 'nav'],
  ['concur', 'erp'], ['vexpense', 'erp'], ['payroll', 'sf'], ['payroll', 'ukg'], ['payroll', 'erp'],
  ['hl', 'nav'], ['hl', 'tripletex'], ['ukg', 'sf'], ['ukg', 'clock'], ['lms', 'sf'], ['bht', 'sf'],
  ['nav', 'biztalk'], ['sfdc', 'erp'], ['d365', 'nav'], ['superoffice', 'erp'], ['svc', 'sfdc'],
  ['konfig', 'erp'], ['konfig', 'teamcenter'], ['portal', 'erp'], ['portal', 'konfig'], ['portal', 'pim'],
  ['b2b', 'erp'], ['b2b', 'pim'], ['pim', 'teamcenter'], ['ifsfs', 'nav'], ['warranty', 'erp'],
  ['ariba', 'erp'], ['wms', 'erp'], ['wms', 'biztalk'], ['lx', 'nav'], ['astro', 'erp'],
  ['handheld', 'wms'], ['nshift', 'wms'], ['customs', 'erp'], ['customs', 'sftp'], ['freight', 'as400'],
  ['kinaxis', 'erp'], ['nordplan', 'erp'], ['nordplan', 'as400'], ['nordplan', 'biztalk'],
  ['as400', 'erp'], ['opcenter', 'nordplan'], ['opcenter', 'pi'], ['mesflo', 'nav'], ['mesflo', 'lx'],
  ['aveva-mes', 'erp'], ['labels', 'opcenter'], ['labels', 'wms'], ['trace', 'opcenter'], ['trace', 'as400'],
  ['maximo', 'erp'], ['maximo', 'pi'], ['ifs', 'nav'], ['lims', 'opcenter'], ['spc', 'pi'],
  ['cert31', 'lims'], ['cert31', 'erp'], ['documentum', 'cert31'], ['pi', 'wincc-g'], ['pi', 'wincc-s'],
  ['pyexport', 'pi'], ['teamcenter', 'erp'], ['synergi', 'sf'],
  ['dataplatform', 'erp'], ['dataplatform', 'sfdc'], ['dataplatform', 'opcenter'], ['dataplatform', 'pi'],
  ['dataplatform', 'adf'], ['adf', 'erp'], ['bw', 'erp'], ['informatica', 'erp'], ['informatica', 'as400'],
  ['bw', 'informatica'], ['dwh-a', 'ssis'], ['ssis', 'nav'], ['powerbi', 'dataplatform'], ['powerbi', 'bw'],
  ['qlik', 'dwh-a'], ['tableau', 'erp'], ['bo', 'bw'], ['reports-xl', 'bw'], ['pdm-ml', 'pi'],
  ['pdm-ml', 'maximo'], ['elasticity', 'bw'], ['databricks', 'dataplatform'],
  ['snow', 'entra'], ['splunk', 'panorama'], ['splunk', 'ad'], ['veeam', 'vmware'], ['citrix', 'vmware'],
  ['nagios', 'vmware'], ['m365', 'entra'], ['spo', 'entra'],
];

// ---- Build ----

const originMap: Record<O, Origin> = { C: 'core', A: 'acquired_A', B: 'acquired_B', S: 'shadow_it' };
const typeMap: Record<T, SystemType> = { cu: 'custom', co: 'cots', sa: 'saas' };
const hostingMap: Record<H, Hosting> = { dc: 'on_prem_dc', pc: 'private_cloud', sa: 'saas', pu: 'public_cloud' };
const sensMap: Record<Sens, DataSensitivity> = { pub: 'public', int: 'internal', per: 'personal', spc: 'special_category' };

const idByKey = new Map<string, string>();
rows.forEach((row, i) => idByKey.set(row.key, `SYS-${String(i + 1).padStart(3, '0')}`));

function eolRiskScore(stack: Stack): number {
  if (stack.eol === null) return stack.eolRiskIfManaged ?? 4;
  const years = stack.eol - REFERENCE_YEAR;
  if (years < 0) return 1;
  if (years <= 1) return 2;
  if (years <= 3) return 3;
  if (years <= 5) return 4;
  return 5;
}

const PROFILE_SCORES: Record<Profile, { bf: [number, number, number]; tf: [number, number, number, number] }> = {
  // bf: coverage, satisfaction, strategic | tf: supportability, security, scalability, documentation
  invest: { bf: [4.2, 4.0, 4.4], tf: [4.3, 4.2, 4.1, 3.8] },
  legacy: { bf: [4.0, 3.2, 4.0], tf: [1.8, 2.0, 2.0, 1.5] },
  eliminate: { bf: [2.2, 2.0, 1.5], tf: [2.0, 2.2, 2.3, 1.8] },
  tolerate: { bf: [3.0, 3.0, 2.0], tf: [4.0, 3.8, 3.6, 3.4] },
  mixed: { bf: [3.2, 3.0, 3.0], tf: [3.0, 3.0, 3.0, 2.6] },
  shadow: { bf: [2.8, 3.4, 1.6], tf: [1.8, 1.5, 2.2, 1.2] },
  duplicate: { bf: [3.0, 3.0, 1.8], tf: [3.2, 3.0, 3.0, 2.8] },
};

const SIZE_COST: Record<SizeClass, [number, number]> = {
  S: [120_000, 750_000],
  M: [900_000, 3_200_000],
  L: [3_200_000, 8_000_000],
  XL: [8_000_000, 16_000_000],
};

// Cost split shares [license, infra, supportFte, vendorSupport] by type/hosting.
function costShares(type: SystemType, hosting: Hosting): [number, number, number, number] {
  if (type === 'saas') return [0.85, 0, 0.13, 0.02];
  if (hosting === 'public_cloud') return type === 'custom' ? [0.02, 0.38, 0.5, 0.1] : [0.35, 0.35, 0.2, 0.1];
  if (type === 'custom') return [0.04, 0.3, 0.56, 0.1];
  return [0.34, 0.24, 0.22, 0.2];
}

const round1k = (x: number) => Math.round(x / 1000) * 1000;

const systems: System[] = rows.map((row) => {
  const stack: Stack = STACKS[row.stack];
  const [l1, l2] = L2[row.l2]!;
  const type = typeMap[row.t];
  const hosting = hostingMap[row.h];
  const origin = originMap[row.o];
  const sens = sensMap[row.sens];
  const p = PROFILE_SCORES[row.profile];
  const noise = () => between(-0.9, 0.9);

  let total = row.cost ?? between(...SIZE_COST[row.size]);
  if (row.profile === 'shadow') total = Math.min(total, between(40_000, 220_000));
  const shares = costShares(type, hosting);
  const jitter = shares.map((s) => s * between(0.8, 1.2));
  const sum = jitter.reduce((a, b) => a + b, 0);
  const [license, infra, supportFte, vendorSupport] = jitter.map((s) => round1k((total * s) / sum)) as [number, number, number, number];

  const directDeps = plantedEdges.filter(([from]) => from === row.key).map(([, to]) => to);
  const eolRisk = eolRiskScore(stack);

  return {
    id: idByKey.get(row.key)!,
    name: row.name,
    vendor: row.vendor,
    description: row.desc,
    capability: { l1, l2 },
    origin,
    type,
    hosting,
    techStack: [...stack.techStack],
    platformEolYear: stack.eol,
    lastMajorUpgrade: Math.round(between(stack.upgrade[0], stack.upgrade[1])),
    users: Math.max(1, Math.round(row.users * between(0.9, 1.1))),
    businessCriticality: row.crit,
    dataSensitivity: sens,
    residencyRequired: sens === 'special_category' || (sens === 'personal' && l1 === 'HR'),
    siteBound: row.site ?? false,
    businessFit: {
      functionalCoverage: clampScore(p.bf[0] + noise()),
      userSatisfaction: clampScore(p.bf[1] + noise()),
      strategicRelevance: clampScore(p.bf[2] + noise()),
    },
    technicalFit: {
      supportability: clampScore(Math.min(p.tf[0] + noise(), eolRisk + 1.5)),
      security: clampScore(p.tf[1] + noise()),
      scalability: clampScore(p.tf[2] + noise()),
      documentation: clampScore(p.tf[3] + noise()),
      eolRisk,
    },
    annualCost: { license, infra, supportFte, vendorSupport },
    integrations: directDeps.map((k) => {
      const id = idByKey.get(k);
      if (!id) throw new Error(`Unknown planted edge target ${k} from ${row.key}`);
      return id;
    }),
    sizeClass: row.size,
    ...(row.dup ? { duplicateGroup: row.dup, isPrimary: row.primary ?? false } : {}),
  };
});

// Generated edges: identity, ERP and middleware hubs plus a few same-L1 links.
// An edge is skipped if it would close a cycle, so the only cycles are the planted ones above.
const byKey = new Map(rows.map((row, i) => [row.key, systems[i]!]));
const byId = new Map(systems.map((s) => [s.id, s]));
function reaches(from: System, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...byId.get(id)!.integrations);
  }
  return false;
}
const link = (s: System, dep: System) => {
  if (dep.id !== s.id && !s.integrations.includes(dep.id) && !reaches(dep, s.id)) s.integrations.push(dep.id);
};
const erpL1: CapabilityL1[] = ['Finance', 'Supply Chain', 'Production/OT', 'Sales & CRM'];
systems.forEach((s, i) => {
  if (i < 4 || s.origin === 'shadow_it' || s.siteBound) return;
  const iam = s.hosting === 'saas' || s.hosting === 'public_cloud'
    ? 'entra'
    : s.origin === 'acquired_A' ? 'ad-a' : s.origin === 'acquired_B' ? 'ad-b' : 'ad';
  if (chance(0.88)) link(s, byKey.get(iam)!);
  if (i > 10 && erpL1.includes(s.capability.l1) && s.integrations.length < 3 && chance(0.45)) {
    link(s, byKey.get(s.origin === 'acquired_A' ? 'nav' : 'erp')!);
  }
  if (i > 10 && s.hosting === 'on_prem_dc' && s.origin !== 'acquired_B' && chance(0.3)) {
    link(s, byKey.get(chance(0.6) ? 'biztalk' : 'po')!);
  }
  const peers = systems.slice(11, i).filter((o) => o.capability.l1 === s.capability.l1);
  const extra = peers.length ? Math.floor(between(0, 2.2)) : 0;
  for (let k = 0; k < extra; k++) link(s, peers[Math.floor(rand() * peers.length)]!);
});
systems.forEach((s) => s.integrations.sort());

// Tarjan SCC — only used to report the cycles in the summary.
function stronglyConnected(): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const st: string[] = [];
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    st.push(v);
    onStack.add(v);
    for (const w of byId.get(v)!.integrations) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = st.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp);
    }
  };
  systems.forEach((s) => idx.has(s.id) || visit(s.id));
  return out;
}

const capabilities: CapabilityDef[] = Object.entries(L2).map(([id, [l1, l2, saasAlternative, example]]) => ({
  id,
  l1,
  l2,
  saasAlternative,
  ...(example ? { saasAlternativeExample: example } : {}),
}));

const portfolio: Portfolio = {
  meta: {
    company: 'Nordlys Gruppen ASA (fiktiv)',
    description:
      'Fictional Norwegian industrial group (hydraulics, castings, components). Grew by acquiring Vestfjord Maskin AS (2022) and Polarkomponent AB (2024); runs its own leased data center whose lease expires in 2028.',
    employees: 4000,
    referenceYear: REFERENCE_YEAR,
    dataCenterLeaseExpiry: 2028,
    acquisitions: [
      { origin: 'acquired_A', name: 'Vestfjord Maskin AS (fiktiv)', year: 2022, employees: 900 },
      { origin: 'acquired_B', name: 'Polarkomponent AB (fiktiv)', year: 2024, employees: 500 },
    ],
    seed: SEED,
    generator: 'scripts/generate.ts (mulberry32)',
  },
  capabilities,
  systems,
};

if (systems.length !== 150) throw new Error(`Expected 150 systems, got ${systems.length}`);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../data/portfolio.json');
writeFileSync(out, JSON.stringify(portfolio, null, 2) + '\n');

// ---- Summary ----
const total = (s: System) => s.annualCost.license + s.annualCost.infra + s.annualCost.supportFte + s.annualCost.vendorSupport;
const countBy = <K extends string>(f: (s: System) => K) =>
  systems.reduce<Record<string, number>>((acc, s) => ((acc[f(s)] = (acc[f(s)] ?? 0) + 1), acc), {});
const groups = countBy((s) => s.duplicateGroup ?? '—');
delete groups['—'];
console.log(`Wrote ${systems.length} systems to ${out}`);
console.log(`Total annual cost: NOK ${(systems.reduce((a, s) => a + total(s), 0) / 1e6).toFixed(1)}M`);
console.log('Hosting:', countBy((s) => s.hosting));
console.log('Type:', countBy((s) => s.type));
console.log('Origin:', countBy((s) => s.origin));
console.log('Size:', countBy((s) => s.sizeClass));
console.log('EOL passed or ≤2027:', systems.filter((s) => s.platformEolYear !== null && s.platformEolYear <= 2027).length);
console.log('Duplicate groups:', Object.keys(groups).length, groups);
console.log('Integration edges:', systems.reduce((a, s) => a + s.integrations.length, 0));
const inDegree = countBy((s) => s.id);
for (const k of Object.keys(inDegree)) inDegree[k] = 0;
systems.forEach((s) => s.integrations.forEach((d) => (inDegree[d] = (inDegree[d] ?? 0) + 1)));
console.log(
  'Top hubs (dependants):',
  Object.entries(inDegree).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => `${byId.get(id)!.name}: ${n}`),
);
console.log('Cycles (SCCs):', stronglyConnected().map((c) => c.map((id) => byId.get(id)!.name)));
