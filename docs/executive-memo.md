# Consolidate first, move to cloud selectively, run the ERP as the critical path: NOK 84M lower run cost a year and a data-center exit by 2028Q4

**To:** CIO, Nordlys Gruppen ASA · **From:** Application portfolio review · **Re:** Rationalisation of 150 systems

## Situation

Nordlys runs 150 applications at an annual run cost of **NOK 297.8M**, including an NOK 18M
data-center facility. 85 systems (57 %) are hosted on-premise. The acquisitions of Vestfjord Maskin
(2022) and Polarkomponent (2024) brought in their own ERP, payroll, warehouse, MES, integration and
BI stacks, which were never integrated.

## Complication

- **Duplication:** 64 systems sit in **24 duplicate groups** doing the same job in the same
  capability, each with its own licences, infrastructure and support staff.
- **End-of-life exposure:** 28 systems that stay in use run on platforms out of support within two
  years, 14 of them already expired.
- **Hard deadline:** the data-center lease expires in **2028**; 81 systems must leave it.

## Recommendation

1. **Consolidate first.** Retire 39 duplicates into one group standard per capability and switch off
   29 low-value systems. This is where the money is.
2. **Move to cloud selectively.** Rehost, replatform, refactor or repurchase only the 37 systems where
   end-of-life risk or the DC exit requires it; retain 45 as-is.
3. **Treat the ERP as the critical path.** Replace SAP ECC with a cloud ERP as a dedicated programme;
   Vestfjord's Dynamics NAV consolidates onto it once it is live.

## Business case (estimates)

| Lever | Annual saving | One-off |
|---|---|---|
| Consolidate 39 duplicates | NOK 47.2M | NOK 27.8M |
| Retire 29 other systems | NOK 11.5M | NOK 1.9M |
| Exit DC facility | NOK 18.0M | – |
| 37 cloud/SaaS moves (incl. ERP NOK 80M) | NOK 7.1M | NOK 145.5M |
| Temporary integrations | – | NOK 2.4M |
| **Total** | **NOK 83.8M (−28 %)** | **NOK 177.5M** |

**5-year NPV NOK 78.8M** at 8 %. Simple payback (steady state) is 2.1 years; cash break-even, when
cumulative cash flow turns positive, is 2030Q2. Moving cloud run cost and migration cost ±30 % gives an NPV between
**−NOK 32.1M and +NOK 189.7M**: if both land 30 % worse, the case is negative over five years.
Cloud and SaaS moves are justified by risk and the DC exit, not by savings; consolidation carries
the economics.

## Roadmap

| Horizon | Scope | Cutovers |
|---|---|---|
| **H1 · 2027Q1–Q3** — quick wins | Switch-offs, rehosts, integration middleware consolidated; ERP programme starts | 41 |
| **H2 · 2027Q4–2028Q4** — transform and exit | Replatform, refactor and repurchase; ERP live 2028Q2; Dynamics NAV consolidated 2028Q3; DC vacated 2028Q4 | 59 |
| **H3 · 2029Q1** — close-out | Last consolidations outside the DC; full run-rate saving | 5 |

## Risks and mitigations

- **ERP slip pushes the DC exit past the lease.** The plan exits in exactly 2028Q4, with no slack.
  *Mitigation:* negotiate a 6–12-month lease extension option now, while there is leverage.
- **Delivery capacity.** Peak demand is 1,793 person-days in a quarter, 100 % of the assumed pool.
  *Mitigation:* contract partner capacity for 2028 before the programme starts.
- **Data residency.** Payroll and time-and-attendance data, which must stay in the EU/EEA, moves to SaaS.
  *Mitigation:* make an EU/EEA or Norwegian region a contract requirement.

## Decisions required in the next 30 days

1. **Confirm the group standard** in each of the 24 duplicate groups, starting with ERP, payroll,
   warehouse and integration middleware.
2. **Mandate the ERP programme** (NOK 80M estimate, 2027Q1–2028Q2) and name a business owner.
3. **Open lease talks** for an extension option, and approve sourcing of partner delivery capacity.

---

*Nordlys Gruppen ASA and all figures are fictional and illustrative. Numbers are produced by a
rules-based engine from labelled estimates, not client data.*
