# 13 — Required pages, notices and mechanisms

**Question asked:** what is the complete set of pages, notices and mechanisms a site
like Foundit needs — legal, regulatory and conventional — so the owner can see the
whole thing at once and fill it in over time.

**Status:** research, September 2026. Not legal advice. Neither the researcher nor the
person who commissioned it is a lawyer. The value of this document is knowing the
*shape* of each obligation and where the real text has to come from; §7 lists the
handful of things that genuinely need a lawyer's name on them.

**How to read the ratings**

| | Meaning |
| --- | --- |
| **MUST** | A law, in a jurisdiction Foundit will actually touch, requires it. |
| **SHOULD** | No law requires it, but a partner will block launch, or it is universal convention and its absence reads as amateur or evasive. |
| **COULD** | Genuinely optional. Worth doing when there is time. |
| **Not yet** | The obligation exists but Foundit is under the threshold. Recorded with the tripwire that brings it back. |

---

## 0. Read this first: four facts that decide most of the answers

Almost every question below resolves differently depending on four facts, and three of
them are not fully settled.

### 0.1 Where is Foundit *established*?

The owner is an individual in Israel. The server is a Hetzner VPS in Falkenstein,
Germany. These pull in opposite directions and the answer changes whether Foundit needs
an EU representative (GDPR Art 27), a DSA legal representative (Art 13), and a German
`Impressum`.

- **The server alone is probably not an establishment.** GDPR Recital 22 defines
  establishment as "the effective and real exercise of activity through stable
  arrangements", and says the legal form is not determinative. The EDPB's territorial-scope
  guidance is explicit that the presence of hardware or a database in the EU is not by
  itself an establishment — but it is equally explicit that the threshold is low, and a
  single agent with sufficient stability can meet it.
  Source: EDPB Guidelines 3/2018, <https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-32018-territorial-scope-gdpr-article-3_en>
- **Art 3(2) almost certainly applies regardless.** Foundit is a public English-language
  website that intends to serve EU visitors and will accept their reviews and accounts.
  That is "offering services to data subjects in the Union" whether or not there is an
  establishment. The practical consequence is the same either way for the *notice* and
  *rights* obligations. It differs only for the representative question and for which
  supervisory authority is the point of contact.
- **Recommendation:** treat Foundit as in scope of GDPR from day one and stop arguing
  about the mechanism. Get a written view on the representative question specifically
  (§7).

### 0.2 Is Foundit a "platform" or a "publisher"?

It hosts user-generated content — reviews and tool listings — that publish immediately
with no moderation queue and are visible to the public. That is what the EU's Digital
Services Act calls an **online platform**, what the UK's Online Safety Act calls a
**user-to-user service**, and what US law treats as an interactive computer service
under §230. Three different regimes, three different obligations, all triggered by the
same design decision (`product-decisions.md` §5, "Nothing waits for approval").

This is the single most consequential legal fact about the product. It does not mean
the design is wrong — it means a specific, small set of pages and routes has to exist
alongside it.

### 0.3 How big is it?

Almost every heavy obligation in this document has a size threshold, and Foundit is
under all of them at launch. Specifically it is:

- a **microenterprise** for EU purposes (fewer than 10 people, turnover under €2m) —
  which matters for the European Accessibility Act;
- a **micro/small enterprise** for DSA purposes — which switches off most of the DSA's
  platform obligations under Art 19;
- under every US state privacy law threshold;
- under the Israeli database-registration and DPO thresholds;
- at €0 revenue, under every revenue-linked fee and reporting regime.

The document states, for each, the tripwire that brings the obligation back.

### 0.4 The moment money changes hands

Several dormant obligations wake up the day the first payment is taken: EU and UK
consumer-contract law (cancellation rights, pre-contract information), auto-renewal
disclosure rules in California and elsewhere, VAT/tax identity disclosure, and the
"trader" status that makes several consumer-protection rules bite harder. Foundit's own
plan already anticipates the hosting-tier consequence of the first payment
(`product-decisions.md` §11); the legal consequence is bigger and is flagged in §5.

---

---

## 1. What Foundit's current design already satisfies

Worth stating first, and stating loudly, because most of this document is a list of
things that do not exist yet — and it would be easy to miss that several of the hardest
requirements are already met, structurally, by decisions made for other reasons.

### 1.1 The search log is a data-minimisation asset, not just a nice idea

`search_events` has no user column, no session id, no IP, no user-agent
(`db/migrations/0001_init.sql:346`). The insert function takes no user id and there is
no parameter to add one to; it returns `void` rather than the new row's id, because an
id handed back to the application is a correlation handle; and a `BEFORE INSERT` trigger
in `0003_hardening.sql` derives `query_hash` from the query text whatever the caller
passes, so the guarantee lives in the table rather than in the one function that is
supposed to be the only way in (`db/migrations/0002_search.sql:497-526`).

What that buys, in the language of each regime:

- **GDPR Art 5(1)(c) data minimisation and Art 25 data protection by design** are not
  claims Foundit has to argue — they are demonstrable from the schema. That is unusual.
  Art 25(1) asks for technical measures "designed to implement data-protection
  principles… in an effective manner"; a column that does not exist is the strongest
  form of that measure there is.
- **The GDPR Art 35 DPIA question gets much easier.** "Describe your problem" text
  collects health, money and relationship troubles — exactly the categories that would
  otherwise push a large-scale free-text log towards a mandatory DPIA. Because the log
  cannot be attributed to a person, the highest-risk processing in the product is
  arguably outside the GDPR's material scope altogether (Recital 26 — anonymous
  information). The DPIA should still be written, and should say this; it will be a
  short one.
- **Subject access (Art 15) and erasure (Art 17) become answerable.** Foundit can say
  truthfully, in the privacy notice, that it cannot return a person's search history
  because it does not have one. Most sites cannot say that.
- **Israel's Amendment 13 fine exposure scales with the number of data subjects in the
  affected database.** A database that holds no attributable search text is a smaller
  number.
- **It survives a subpoena, a breach, and a future feature.** The comment in the
  migration makes this point better than a policy could: a column that does not exist
  cannot be leaked or quietly joined in later.

**Action:** say this in the privacy notice, in plain words, near the top. It is the
single most trust-building sentence available and it costs nothing because it is true.
It is also worth a short public page (§3, "How search works / what we don't keep").

### 1.2 The operator dashboard's privacy line is already drawn correctly

`product-decisions.md` §10 states that search text is visible only in aggregate,
deduplicated and counted; individual users are visible only through what they did in
public; and the two are never joined. Enforcement is an `is_admin` flag checked by the
database's row-level rules, not by the page. That is a **purpose limitation** boundary
(GDPR Art 5(1)(b)) implemented as an access-control boundary, which is the form
regulators actually accept.

### 1.3 Deletion already cascades

Every table that holds personal data references `profiles(id)` with
`on delete cascade` — reviews, likes, collections, collection items, claims
(`db/migrations/0001_init.sql`). `tools.submitted_by` and `tools.owner_id` are
`on delete set null`, which is the right call: the listing survives as catalogue
content while the link to the person is severed. `product-decisions.md` §4 already
commits that deleting an account removes that person's own reviews.

This means the erasure right (GDPR Art 17, UK the same, Israel's Amendment 13, and every
US state law that has one) is one `DELETE FROM profiles` away from being genuinely
honoured rather than a promise the page makes and the database breaks. What is **not**
yet handled is backups — see §4.1, the one place where "delete" needs a written policy
rather than a foreign key.

### 1.4 The outbound link is already built the way the guidance wants

`product-decisions.md` §12: `https` only, `rel="noopener noreferrer"`, opens in a new
tab, the destination domain shown next to the button, and the click counted without
attaching it to a person. Showing the destination before the click is a genuine
consumer-protection nicety, and the click counter being person-free means the
"opened from Foundit" number on the maker dashboard is not a behavioural profile.

The distinction the decisions file draws — the visitor's browser fetches the maker's
site, Foundit's server never does — also keeps Foundit clear of a whole class of
server-side-request problems and of any argument that it is republishing the
destination's content.

### 1.5 No advertising, no ad tech, no third-party trackers

This is the reason large parts of the US state privacy laws, the CPRA's
"Do Not Sell or Share" machinery, and the noisiest parts of the cookie rules simply do
not engage. It is worth keeping as a stated product commitment, because reintroducing
any of it reintroduces all of them at once.

### 1.6 Reviews are immutable to everyone but their author

`product-decisions.md` §4: nobody can edit or delete someone else's review — not the
maintainer, not the operator; a maintainer may only reply. This lands almost exactly on
what the FTC's 2024 reviews rule and the UK's DMCC fake-review provisions are trying to
prevent, which is suppression of unfavourable reviews by the reviewed party.

**But note a real tension.** The row-level rules are stricter than the product decision:
`reviews_update` is author-only and `auth.is_admin()` appears *only* in `reviews_read`,
with an explicit comment that "there is deliberately no policy granting the tool's
owner, or anyone else, any write access at all"
(`db/migrations/0001_init.sql:535-546`). So the application, running as the app role,
**cannot take down a review at all** — not even an illegal one. Both the DSA's notice-
and-action duty and the UK OSA's illegal-content duty require the operator to be able to
act on a valid notice. Removal is still possible out of band, because the database owner
role bypasses RLS, and at launch scale a hand-run `update … set deleted_at = now()` is a
defensible implementation of "acting on notice". Three things need to be true for that to
hold up:

1. It is written down as the procedure, with who does it and how fast (§4.5).
2. The takedown is recorded somewhere, because a statement of reasons has to be given to
   the author (DSA Art 17).
3. Nobody mistakes the RLS comment for a promise that illegal content stays up. The
   comment is about *ownership not conferring power over someone else's words*, which is
   correct and should survive; it is not about the operator's legal obligations.

An admin-scoped soft-delete policy on `reviews`, distinct from an edit policy, is the
clean fix — power to remove, never power to alter.

### 1.7 The footer already reserves the right slots

`components/SiteFooter.tsx` links About, Guidelines, Contact, Privacy. Four of the
five most important pages already have a home; **Terms** is the missing one, and the
Guidelines link is the natural anchor for the content-policy obligations in §2.

---

## 2. Jurisdiction by jurisdiction

**Not legal advice.** A reading of published primary sources by someone who is not a
lawyer; anything unverifiable against an official source is marked **unverified**. §7
lists what to pay for.

**One finding drives the rest.** The e-Commerce Directive says "the presence and use of
the technical means and technologies required to provide the service do not, in
themselves, constitute an establishment of the provider" (Dir 2000/31/EC Art 2(c),
<https://eur-lex.europa.eu/eli/dir/2000/31/oj>). So the Falkenstein VPS is **not** an EU
establishment, Foundit is a non-EU provider offering services into the Union, and: a GDPR
Art 27 representative is probably required, a DSA Art 13 legal representative is probably
required, the German `Impressum` probably is *not*, and with no establishment there is no
one-stop shop, so every affected supervisory authority is in principle competent. The
opposite of "the server is in Germany, so German law applies", and the item most worth a
lawyer's hour (§7.1).

### 2.1 EU / EEA

| Instrument | Rating, and what it demands |
| --- | --- |
| **GDPR 2016/679** <https://eur-lex.europa.eu/eli/reg/2016/679/oj> | **MUST** (Art 3(2)). Notice per Arts 13/14; a lawful basis per purpose; working Art 15–22 routes; records of processing — Art 30(5)'s under-250-staff carve-out falls away where processing is not occasional; 72-hour breach notification (Art 33); Art 32 security |
| **GDPR Art 27** representative | **MUST** unless the establishment reading is wrong. A person or entity in a Member State where the data subjects are, appointed in writing and named in the notice. The Art 27(2)(a) exemption needs "occasional" processing; a live site is not. EDPB Guidelines 3/2018 part 4 |
| **DSA 2022/2065** <https://eur-lex.europa.eu/eli/reg/2022/2065/oj> | **MUST** — hosting service *and* online platform. Art 11 contact point for authorities; Art 12 contact point for users, published and expressly not solely automated; **Art 13 legal representative**; Art 14 terms stating restrictions, moderation policies and any algorithmic decision-making, in plain language; **Art 16 notice-and-action**; **Art 17 statement of reasons** to the author of anything removed; Art 18 report suspected serious crime |
| **DSA Art 15** transparency report, and **Arts 20–28** (complaints, out-of-court dispute, trusted flaggers, ads, recommender transparency, minors) | **Not yet** — Art 15(2) and **Art 19** switch these off for micro/small platforms. Tripwire: ≥50 staff or >€10m, with 12 months' grace (Art 19(2)) — short enough that the appeal route in §4.5 is worth building anyway |
| **UCPD 2005/29 as amended by 2019/2161** <https://eur-lex.europa.eu/eli/dir/2005/29/oj>, <https://eur-lex.europa.eu/eli/dir/2019/2161/oj> | **MUST** — no size threshold. **Art 7(4a):** a site letting consumers search products from different traders by keyword must give the **main ranking parameters and their relative importance** in a section **directly and easily accessible from the results page**. **Art 7(6):** say whether and how you check reviews come from consumers who used the product. **Annex I 23b/23c/23d** ban undisclosed paid ranking, unchecked "genuine review" claims and fake reviews outright. Guidance 2021/C 526/01 <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52021XC1229(05)> |
| **P2B 2019/1150** <https://eur-lex.europa.eu/eli/reg/2019/1150/oj> | Probably **out of scope**: it needs services facilitating direct transactions, or a search engine over in principle all websites. Keep writing to its ranking guidelines anyway (§3.8) |
| **ePrivacy 2002/58 Art 5(3)** <https://eur-lex.europa.eu/eli/dir/2002/58/oj> | **No banner** on today's design. Consent unless strictly necessary for a service the user asked for: the login session cookie is necessary; Cloudflare's security cookie is arguable, document it; Sentry is not. Scope is technology-neutral — `localStorage` and fingerprinting count (EDPB Guidelines 2/2023 <https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en>). **Tripwire: the first analytics script, or Sentry in the browser** |
| **CRD 2011/83 + DCD 2019/770** | **Not yet** — §5 |
| **European Accessibility Act 2019/882** <https://eur-lex.europa.eu/eli/dir/2019/882/oj> | **Not yet**: e-commerce services from 28 June 2025, and Art 4(5) exempts microenterprises providing services. Tripwire: ≥10 people or >€2m. Build to WCAG 2.2 AA anyway |

Art 7(4a) is what makes the "How we rank" page (§3.8) a legal requirement, and it
dictates where the link goes — the results page, not only the footer.

### 2.2 Germany specifically

- **`Impressum`, §5 DDG** <https://www.gesetze-im-internet.de/ddg/__5.html> — **SHOULD**,
  as cheap insurance. §5 binds *Diensteanbieter* for commercially offered digital
  services and the German duty follows establishment, which the server is not. A "Legal
  notice" page — name, postal address, email, legal form — costs an hour and closes it.
- **Cookies, §25 TDDDG** <https://www.gesetze-im-internet.de/ttdsg/__25.html> — same
  caveat, same answer as ePrivacy: §25(2) exempts the strictly necessary, so no banner.
  The TTDSG was **renamed** TDDDG on 14 May 2024 and is still served under the old
  `/ttdsg/` path; a surprising URL is not a repealed law.

### 2.3 UK

| Instrument | Rating, and what it demands |
| --- | --- |
| **UK GDPR + DPA 2018** <https://www.legislation.gov.uk/ukpga/2018/12/contents>; **PECR reg 6** <https://www.legislation.gov.uk/uksi/2003/2426/regulation/6> | **MUST.** Substantively the EU list; the UK representative question mirrors Art 27 with the same answer; the cookie analysis is identical, so no banner |
| **PECR reg 22** <https://www.legislation.gov.uk/uksi/2003/2426/regulation/22> | **MUST** for marketing mail: consent or the soft opt-in, identify the sender, give an address. A login code is not marketing |
| **Online Safety Act 2023** <https://www.legislation.gov.uk/ukpga/2023/50/contents> | **MUST** — a user-to-user service with links to the UK. A written **illegal content risk assessment**, kept current and redone before a significant change; a **children's access assessment**; **reporting** and **complaints** routes that are easy to find; **record-keeping**; terms saying how illegal content is handled. Ofcom's first deadline was **16 March 2025**, so Foundit is late on the day it launches — do it *before* launch. Small and low-risk means proportionate measures, not exemption. <https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/illegal-content-duties-under-the-online-safety-act>, <https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/check-how-to-comply-with-the-illegal-content-rules> |
| **DMCC Act 2024** fake reviews <https://www.legislation.gov.uk/ukpga/2024/13/contents>, CMA207 <https://www.gov.uk/government/publications/unfair-commercial-practices-cma207> | **MUST.** Already researched: a public review policy, a report mechanism on each review, a proportionate fake-review risk assessment, and never selling ranking prominence unlabelled |
| **DMCC Part 4 Ch 2** subscriptions <https://www.legislation.gov.uk/ukpga/2024/13/part/4/chapter/2> | **Not yet** — §5; DBT anticipates **spring 2027** <https://www.gov.uk/government/consultations/consultation-on-the-implementation-of-the-new-subscription-contracts-regime> |

### 2.4 Israel

Israeli law applies because the owner controls the database from Israel, wherever the
server sits. Sources: PPA legislation index
<https://www.gov.il/en/departments/legalInfo/legislation>; unofficial English PPL
<https://www.gov.il/BlobFolder/legalinfo/legislation/en/Protection-of-Privacy-Law57411981unofficialtranslatioup.pdf>.

| Item | Rating, and what it demands |
| --- | --- |
| **PPL s.11** notification duty | **MUST.** When asking for data, state whether there is a legal duty to give it, the purpose, and to whom it goes — a line **at the sign-in and add-a-tool forms**, not buried in the notice |
| **Amendment 13**, in force **14 Aug 2025** | Mostly **Not yet.** It narrowed database registration, added a "data of special sensitivity" category, and tied the DPO (*ממונה על הגנת הפרטיות*) duty and a notification duty to size and sensitivity. Foundit is far under; **the exact thresholds are unverified here** — read them off the PPA before launch. Tripwires: special-sensitivity data, or crossing the large-database threshold |
| **Data Security Regs 5777-2017** <https://www.gov.il/en/pages/data_security_eng> | **MUST**, basic level: database definition document, access control, incident procedure — internal records, not pages (§7.3) |
| **Communications Law s.30A** (MoC FAQ <https://www.gov.il/en/pages/17052018_7>) | **MUST** for marketing mail: prior express written consent before any "advertisement" — a message promoting a purchase or other spending. **A login code is not an advertisement.** A newsletter is, plus the prescribed opt-out. Statutory damages up to ₪1,000 per message with no proof of loss |
| **Consumer Protection Law** <https://www.gov.il/en/departments/consumerprotection> | **Not yet** — distance-selling disclosure bites at the first payment (§5.5) |
| **Accessibility statement** — Accessibility Adjustments to Service Regs 5773-2013 <https://www.gov.il/he/departments/legalInfo/service_accessibility_regulations>, text <https://www.nevo.co.il/law_html/law01/500_865.htm> | **MUST.** Already researched: exempt from the technical conformance work under **reg 35ו(ז)**, but **reg 34(ה)/35ה still requires a published accessibility statement** — prominent, saying what is and is not accessible, naming an accessibility contact and a route to report a problem. A page, not a project; pairs with the W3C statement in §3.7 |

### 2.5 US — federal

| Instrument | Rating, and what it demands |
| --- | --- |
| **47 U.S.C. §230** <https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title47-section230> | Nothing to file — a defence, not a page, and weakened by *editing* user content, which makes §1.6's "power to remove, never to alter" the §230-safe design too |
| **DMCA §512(c)** <https://www.copyright.gov/512/>, <https://www.copyright.gov/dmca-directory/> | **MUST** for the safe harbour, and both halves are needed: **designate an agent in the Copyright Office's electronic directory** (a fee, renewable every three years) **and** publish the same contact on the site, plus a repeat-infringer policy and a counter-notice route |
| **FTC Consumer Reviews Rule, 16 CFR 465**, effective 21 Oct 2024 <https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465>, Q&A <https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers> | **MUST.** Bans fake and purchased reviews, undisclosed insider reviews, and review suppression. §1.6 already lands right on suppression; what must be *written down* is: no incentivised reviews, no self-reviews, insiders disclosed |
| **Endorsement Guides, 16 CFR 255** <https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking> | **MUST** the day an affiliate link or paid placement appears: clear and conspicuous **at each link**, never once in the footer |
| **COPPA, 16 CFR 312** <https://www.ecfr.gov/current/title-16/part-312> | **Not yet — design to keep it so.** Say "not intended for under-13s" in the Terms, do not collect age, build nothing that confers actual knowledge of an under-13 user |
| **CAN-SPAM, 16 CFR 316** <https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business> | **MUST** for commercial email: accurate headers, honest subject, a **valid physical postal address**, opt-out within 10 business days. Login codes are exempt from most of it but not header accuracy. **Get a post box** — otherwise this publishes a home address |

### 2.6 US — states

Already researched; at zero users and zero revenue almost nothing bites.

| State | Rating, and what it demands |
| --- | --- |
| **Rhode Island §6-48.1-3**, in force 1 Jan 2026 <https://webserver.rilegislature.gov/Statutes/TITLE6/6-48.1/6-48.1-3.htm> | **MUST** — **no size threshold.** Identify the categories of personal data collected through the site, identify every third party to whom PII has been or may be sold, and give an active email or other online contact. Foundit sells nothing, so the middle item is one honest sentence — but it has to be present |
| **Connecticut** <https://www.cga.ct.gov/current/pub/chap_743jj.htm> | **MUST** in form, nothing to do: the volume thresholds are far off, and the sensitive-data prong reaches sensitive data regardless of volume — of which Foundit processes none. *Precise subsection unverified.* Tripwire: any field that could be health, precise location, biometric or immigration status |
| **Texas §541.002 / §541.107** <https://statutes.capitol.texas.gov/Docs/BC/htm/BC.541.htm> and **Nebraska** (chapter index <https://nebraskalegislature.gov/laws/browse-chapters.php?chapter=87>; *section number unverified*) | **Not yet.** No numeric threshold, but a **US SBA small business** is excluded — except that selling sensitive data still needs consent, and Foundit sells nothing. Tripwire: ceasing to be an SBA small business |
| **California CCPA/CPRA** <https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140>, CPI adjustments <https://cppa.ca.gov/regulations/cpi_adjustment.html> | **Not yet:** "business" needs >$25m gross revenue (adjusted upward for inflation), or 100,000+ California consumers or households, or 50%+ of revenue from selling or sharing — and §1.5 keeps the third out of reach. California's auto-renewal law: §5.4 |

**The cheap way to handle all of it.** One honest privacy notice naming the categories
collected, the purposes, the retention, the recipients and the rights, with a working
email contact, satisfies Rhode Island today and every other state law on the day it
applies — and it is the same document the GDPR already requires.

---

## 3. Conventional but expected

No law requires most of what follows. A partner will block launch over some of it, and
users will quietly distrust the site over the rest.

### 3.1 The hard gate: Google's sign-in requirements

This is the one item on the whole list that will actually stop launch, and it is worth
handling first because it is cheap and it forces two other pages into existence.

To take a "Sign in with Google" app out of testing and into production, Google requires:

| Requirement | Detail |
| --- | --- |
| A **published privacy policy URL** | "should be hosted within the domain that hosts your homepage", linked **from the homepage** and **from the OAuth consent screen**, and the two links must match |
| A **terms of service URL** | Homepage, privacy policy and ToS links are "required for all external production apps" |
| A **homepage that explains the product** | Must "describe your app's functionality to its users" and **cannot be only a login page** |
| **Domain ownership verification** | `foundit.tools` verified in Google Search Console by a project owner or editor |
| An accurate **app name and logo** | Logo ≤1MB, square 120×120; name must not be confusable with Google or another brand |
| Current **developer contact details** | In the Cloud Console |

Sources: <https://support.google.com/cloud/answer/13464321>,
<https://support.google.com/cloud/answer/15549049>,
<https://developers.google.com/terms/api-services-user-data-policy>

**The scope decision that saves weeks.** Foundit needs only `openid`, `email` and
`profile`. These are **non-sensitive**, and Google's own documentation says that an app
using only non-sensitive scopes is **not required to complete app verification**
(<https://support.google.com/cloud/answer/13463073>). There is no CASA security
assessment, no demo video and no Limited Use disclosure clause — all of which are
triggered by *restricted* scopes such as Gmail or Drive. Do not add a scope beyond those
three without understanding that it moves Foundit into a months-long review.

You still want **brand verification** — the light process, minutes not weeks — so the
consent screen says "Foundit" with a logo rather than a raw client ID and a warning.

**Why testing mode cannot ship.** Testing-status apps are capped at 100 allowlisted test
users, and refresh tokens expire after 7 days. There is an exception for apps requesting
only a subset of name, email and profile — which is Foundit — but the pages are still
required for production status, so build them anyway.
(<https://developers.google.com/identity/protocols/oauth2/production-readiness/overview>)

**Button branding is prescriptive.** Allowed call-to-action text is only "Sign in with
Google", "Sign up with Google" or "Continue with Google"; the font is Google Sans Medium;
three permitted themes; specified padding. A monochrome or recoloured "G", or the "G"
without the button boundary, is prohibited.
(<https://developers.google.com/identity/branding-guidelines>) Note that this collides
with the Toybox visual direction — 2px ink borders and offset shadows — so decide early
how the Google button will sit inside that design without breaking the guidelines.

**Cross-reference:** `product-decisions.md` §2 says the designed sign-in screens still
show an Apple button that must be removed. Do that in the same pass.

### 3.2 Email that arrives

**MUST**, in the practical sense that mail which fails these is rejected or binned by the
receiving server regardless of what any law says. Applies at **any volume**, including a
handful of login codes a day:

- **SPF or DKIM** on the sending domain (do both).
- **Valid forward and reverse DNS** for the sending IP.
- **TLS** on transmission.
- **Spam rate below 0.30%** in Postmaster Tools; Google recommends staying under 0.10%.
- RFC 5322-conformant format and a resolvable `From:` domain.

Sources: <https://support.google.com/a/answer/81126>,
<https://senders.yahooinc.com/best-practices/>

At **5,000 messages a day to personal Gmail** the bar rises: SPF *and* DKIM *and* DMARC,
`From:` alignment, RFC 8058 one-click unsubscribe on marketing mail, and unsubscribes
processed within 48 hours. Bulk-sender status is **permanent once assigned** — crossing
5,000 once locks it in. (<https://support.google.com/a/answer/14229414>)

**Login codes are transactional.** Google names one-time passwords explicitly as
non-subscription messages, so they are exempt from the unsubscribe requirement — but
**not** from SPF/DKIM/DMARC, TLS, DNS or spam rate.
(<https://support.google.com/mail/answer/15263077>)

**Do it before the first code goes out.** SPF, DKIM, DMARC at `p=none` with a `rua=`
mailbox, TLS, PTR. Retrofitting after the domain's reputation is damaged is much harder.

**Keep marketing mail on a separate stream or subdomain from login codes**, so a
newsletter reputation problem cannot lock people out of their accounts.

Microsoft applies equivalent rules to outlook.com/hotmail.com/live.com for senders above
5,000/day since 5 May 2025, rejecting non-compliant mail with `550 5.7.15`
(<https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%e2%80%99s-new-requirements-for-high%e2%80%90volume-senders/4399730>
— vendor blog, first-party).

### 3.3 `/.well-known/security.txt` — SHOULD, and close to a must for a site with UGC

RFC 9116 (<https://www.rfc-editor.org/rfc/rfc9116.html>, <https://securitytxt.org/>).
Served over HTTPS as `text/plain; charset=utf-8` at
`https://foundit.tools/.well-known/security.txt`.

Exactly two fields are **required**: `Contact:` and `Expires:` — and the RFC recommends
`Expires` be less than a year out. A file past its `Expires` is stale, so put a calendar
reminder to roll it. Optional and worth having: `Policy`, `Preferred-Languages`,
`Canonical`, `Encryption`.

```
Contact: mailto:security@foundit.tools
Expires: 2027-01-01T00:00:00.000Z
Policy: https://foundit.tools/security
Preferred-Languages: en, he
Canonical: https://foundit.tools/.well-known/security.txt
```

Foundit specifically needs this because it renders user-submitted listings and reviews
and emits outbound links: XSS, open-redirect and IDOR reports *will* arrive. Without a
stated channel they arrive by public tweet, or as extortion, or not at all.

### 3.4 A vulnerability disclosure page — SHOULD

Where `Policy:` points. The reference text is **CISA's VDP template**
(<https://www.cisa.gov/vulnerability-disclosure-policy-template>), written for US federal
agencies but used as the generic template everywhere. Four elements: **scope**,
**safe-harbour authorisation**, a **submission channel**, and a **response commitment**.

CISA recommends using its authorisation wording close to verbatim — the sentence that
matters is that good-faith research in line with the policy is considered authorised and
will not be met with legal action. For Foundit, the scope section must also say that
Hetzner, Cloudflare, Sentry and the email sender are **third parties you cannot authorise
testing against**, and that the third-party tools in the catalogue are entirely out of
scope. Accept reports anonymously. If there is no bounty, say so and offer credit.

Related: ISO/IEC 29147 (external disclosure) and ISO/IEC 30111 (internal handling);
disclose.io publishes vendor-neutral templates (<https://disclose.io/framework/>).

### 3.5 robots.txt, sitemap.xml and the AI-crawler decision

**robots.txt — MUST** in the practical sense. Now a Proposed Standard, RFC 9309
(<https://www.rfc-editor.org/rfc/rfc9309.html>). Two operational traps worth knowing:

- **5xx means "assume full disallow."** A flaky origin behind Cloudflare returning 5xx on
  `/robots.txt` will quietly deindex the site. 4xx means the opposite — crawl everything.
- It is **"not a form of access authorization."** Never use it to hide anything.

**What Foundit should put in it:**

- **Disallow its own search-result URLs.** A "describe your problem" product generates an
  unbounded URL space. Google's crawl-budget guidance says to block these in robots.txt
  and explicitly says **not** to use `noindex` for them, because Google still fetches the
  page before dropping it, wasting crawl budget
  (<https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget>).
- **Allow tool detail pages** — these are the unique, linkable assets. But note the risk
  created by publishing immediately: Google's spam policies name **scaled content abuse**,
  **thin affiliation** (product descriptions copied from the merchant with no added value)
  and **user-generated spam**
  (<https://developers.google.com/search/docs/essentials/spam-policies>). A catalogue of
  restated vendor copy is exactly the pattern. Consider `noindex` on a listing until it
  has at least one review or has been looked at.
- Remember that a disallowed page **can still be indexed** if linked from elsewhere; only
  `noindex` or authentication actually excludes
  (<https://developers.google.com/search/docs/crawling-indexing/robots/intro>).

**sitemap.xml — SHOULD.** <https://www.sitemaps.org/protocol.html>. `<loc>` is the only
required child; 50,000 URLs and 50MB per file; Google ignores `changefreq` and `priority`
but uses an honest `lastmod`. Generate from published listings only.

**AI crawlers — SHOULD make an explicit choice, and this is a live, unsettled area.**
Split the decision by purpose rather than blanket-blocking:

| Purpose | Tokens | Foundit's likely answer |
| --- | --- | --- |
| Training | `GPTBot`, `ClaudeBot`, `Google-Extended` | Block — costs nothing in discovery |
| AI search / answers | `OAI-SearchBot`, `Claude-SearchBot` | **Allow** — these are exactly the surfaces where a tool-recommendation site wants to be cited |
| User-initiated fetch | `ChatGPT-User`, `Claude-User` | Allow |

Google states that `Google-Extended` "does not impact a site's inclusion in Google Search
nor is it used as a ranking signal"
(<https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers>).
OpenAI states that sites opted out of `OAI-SearchBot` "will not be shown in ChatGPT
search answers" (<https://developers.openai.com/api/docs/bots>). Anthropic's tokens and
verified IP list are at
<https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>.

The IETF's **AIPREF** working group is standardising a `Content-Usage` signal with
`train-ai` and `search` categories, carried as an HTTP response header and as a
robots.txt rule (<https://ietf-wg-aipref.github.io/drafts/draft-ietf-aipref-vocab.html>).
Not yet an RFC — do not depend on it, but the syntax is stable enough to emit alongside
the classic directives.

**Check what Cloudflare has already decided for you.** Cloudflare offers Managed
robots.txt on all plans including Free, which **prepends** its own block to yours in a
single response — verify the merged output, because a prepended broad group can shadow
your own more specific groups
(<https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/>).
From 15 September 2026 the old single "Block AI Bots" switch is replaced by three
behavioural classes — Search, Agent and Training — and new domains onboarding to
Cloudflare get Training and Agent blocked by default
(<https://developers.cloudflare.com/changelog/post/2026-07-01-ai-traffic-options/>). A
default nobody chose may already be blocking the crawlers Foundit wants.

### 3.6 Sub-processor list and DPA page — SHOULD now, MUST the first time a business user asks

A public page listing, per vendor: legal entity, purpose, categories of data, processing
location, link to their DPA, link to their own sub-processor page. Plus a plain statement
that data lives on one machine in Falkenstein, Germany.

Every vendor in Foundit's stack has a DPA a solo operator can accept without a
negotiation:

| Vendor | DPA | How it is accepted |
| --- | --- | --- |
| **Cloudflare** | <https://www.cloudflare.com/cloudflare-customer-dpa/> | **Automatic** — forms part of the self-serve agreement, no signature. Sub-processors: <https://www.cloudflare.com/gdpr/subprocessors/> |
| **Sentry** | <https://sentry.io/legal/dpa/> | Requires **active acceptance** in-app — do not assume it. Sub-processors: <https://sentry.io/legal/subprocessors/>, 30 days' notice |
| **Google Cloud** | <https://cloud.google.com/terms/data-processing-addendum> | Accept explicitly in console. Sub-processors: <https://cloud.google.com/terms/subprocessors> |
| **Resend** (recommended in `research/09` §6) | <https://resend.com/legal/dpa> | **Automatic** on entering the agreement. Sub-processors: <https://resend.com/legal/subprocessors>, 14 days' notice |
| **Postmark** | <https://postmarkapp.com/dpa> | **Automatic** on agreeing to the Terms. Sub-processors: <https://postmarkapp.com/eu-privacy#sub-processors>, 7-day objection window |
| **Amazon SES** | <https://aws.amazon.com/service-terms/> | **Automatic**; the 2021 SCCs apply automatically to non-EEA transfers. Sub-processors: <https://aws.amazon.com/compliance/sub-processors/> |
| **Hetzner** | AVV/DPA accepted in the console | EU-based, so no transfer mechanism needed |

**Two cautions.**

1. **Sentry's DPA does not commit to EU-only processing** — it reserves the right to
   process in the US "and any other country" where it operates. Sentry offers an EU data
   region; confirm the organisation is actually provisioned in it, or say plainly in the
   privacy notice that error data goes to the US.
2. **Verify Data Privacy Framework claims yourself.** The DPF list is published by the US
   Department of Commerce at <https://www.dataprivacyframework.gov/list> with a search at
   <https://www.dataprivacyframework.gov/s/participant-search>. It also carries *inactive*
   participants, so an entry alone proves nothing — check the status is Active and that
   the certification covers non-HR data. The EDPB's business FAQ is at
   <https://www.edpb.europa.eu/system/files/2024-07/edpb_dpf_faq-for-businesses_en.pdf>.
   Note that the DPF's legal durability is itself contested; §6.1 covers that.

### 3.7 The rest of the conventional pages

**Expected because a partner or platform demands them**

| Page | Why |
| --- | --- |
| **Privacy** | Google OAuth gate; and every app store or ad partner later |
| **Terms** | Google OAuth gate; and the only place to disclaim liability for third-party tools Foundit links to |
| **Homepage that explains the product** | Google requires it in words: must describe functionality, cannot be only a login page |
| **Contact** | Google requires a support address in the OAuth config |
| **404** | Must return HTTP 404, not a 200 with an apology. `app/not-found.tsx` exists — check the status code |

**Expected because their absence reads badly**

- **Community Guidelines** — already in the footer, currently unwritten. Because listings
  publish immediately, this is the *only* stated basis on which anything can be removed.
  Without it every removal is an argument. Must cover: what listings are allowed, what
  reviews are allowed (no self-reviews, no incentivised reviews, no competitor attacks),
  what gets removed, and how to appeal. It is also the document a regulator reads first.
- **Acceptable use** — either a section of Terms or its own page. Scraping, automated
  submission, malware or phishing links in listings, and consequences. Different audience
  from Terms: this is what you point at when banning someone.
- **Copyright / DMCA** — see §2, US. Elevate to **MUST** if the US safe harbour is wanted:
  §512(c) requires both registering an agent with the Copyright Office *and* publishing
  that agent's contact details on the site
  (<https://www.copyright.gov/dmca-directory/>). Relevant because user-submitted listings
  will carry copied marketing copy and logos.
- **Accessibility statement** — W3C names three required components: a commitment, the
  **standard applied** (say WCAG 2.2 level AA), and **contact details for people who hit
  problems**. Written in plain language — "videos have no captions", not "SC 1.2.2 not
  met". There is a free generator.
  (<https://www.w3.org/WAI/planning/statements/>,
  <https://www.w3.org/WAI/planning/statements/generator/>)
- **Security page** — where `security.txt`'s `Policy:` points, and the page a prospective
  paying customer reads: what is encrypted, where data lives, who the sub-processors are,
  how incidents are handled.
- **How the fit score works** — see §3.8. Highest-value trust page on the site, and in the
  EU it is not merely conventional (§2).
- **Pricing, while still free** — a page saying "free today; here is what will be paid
  later and what stays free." The absence of a pricing page reads as "free until it
  isn't", and pre-empts the backlash when charging starts.
- **Report a problem** — a link on every listing and every review, not only in the footer.
- **Account deletion** and **data export** — in-product and self-serve. "Email us to
  delete" is the pattern regulators single out as a dark pattern.
- **FAQ / Help** — reduces support load for a solo operator and ranks for long-tail queries.

**Nice to have**

- **About** — already in the footer. For an unknown domain recommending third-party
  software, a named human converts better than a faceless "we".
- **Status page**, hosted **off** the VPS — a status page on the machine that is down is
  theatre. Worth it once there are paying customers, given one server with no redundancy.
- **Changelog** — cheap proof the project is alive. An unmaintained one is worse than none.
- **Press kit** — logo SVG and PNG in both themes, one-sentence and one-paragraph
  descriptions, screenshots, contact. Thirty minutes, and it stops journalists
  screenshotting the homepage badly.
- **500 page** served by Cloudflare or the reverse proxy, not by the app — the app is what
  failed. Must return HTTP 500.

### 3.8 The two pages a ranking site owes its users

Foundit ranks third-party products by a fit score and intends to monetise later. Two
pages carry that, and both should be reachable **from the results page**, not buried in
the footer. In the EU one of them is legally required (§2); everywhere else it is the
difference between a credible comparison site and a suspected pay-to-play one.

**"How we rank"** — the structure that satisfies both the FTC's expectation and the EU's
ranking-transparency standard:

1. **What the fit score is** — computed from the user's problem description against tool
   descriptions using an embeddings/LLM model, plus whatever else feeds it.
2. **The main parameters, named and ordered, with the reason each weighs as it does.**
3. **What does not affect ranking** — the load-bearing sentence: *no tool can pay to rank
   higher; vendors cannot influence their fit score.* Say it plainly and keep it true.
4. **Where listings come from** — user-submitted, published immediately, moderated after
   the fact; and whether maker-submitted listings are labelled as such.
5. **How reviews are collected, moderated and aggregated** — the FTC asks for this
   explicitly. Include: negative reviews are published; reviews are not edited; reviews
   are not paid for; here is how the overall score is computed; here is how to report one.
6. **Conflicts** — any tool the owner built, invested in or is affiliated with, labelled
   at the point of display.
7. **Limitations** — the honest paragraph that buys the most credibility: the score is a
   heuristic, coverage is incomplete, not every tool has been tested.
8. **How a vendor corrects a listing.**
9. **A dated changelog of methodology changes.**

The right calibration is set out in the European Commission's ranking-transparency
guidelines: describe the **main** parameters and why they weigh as they do, **without**
disclosing the detailed functioning of the algorithm or anything that would let someone
game it (2020/C 424/01,
<https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:52020XC1208(01)>). Those
guidelines are written for the P2B Regulation, which probably does not cover Foundit
(§2) — but they remain the clearest published description of what "enough detail, not too
much" looks like, and writing to them is a safe target.

FTC guidance for platforms displaying reviews and rankings asks for disclosure of *how
you collect, process and display reviews, and how you determine overall ratings*
(<https://www.ftc.gov/business-guidance/resources/featuring-online-customer-reviews-guide-platforms>).

**"How we make money"** — write it now, while the answer is "we don't":

- Today: nothing. Foundit is free and unmonetised.
- Planned: paid accounts. State whether paid accounts will ever affect ranking — the
  answer should be no — and what they buy instead.
- If affiliate links are ever added they must be labelled **at each link**, not once in
  the footer, and the methodology page must say whether affiliate status is a ranking
  input. The defensible commitment, worth writing down before revenue tempts otherwise:
  disclosed, and **never an input**
  (<https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking>).
- If sponsored placement is ever added it must be visually and verbally distinct from
  organic results and labelled. The CMA's online-choice-architecture work specifically
  names the fading distinction between paid and organic as a consumer harm.

---

## 4. Mechanisms, not pages

A cookie banner only matters if consent is actually gated on it. A "delete my account"
page only matters if deletion actually deletes. This section is the behaviour half.

### 4.1 Deletion that deletes — and the backup question

**What Foundit already has:** cascading foreign keys (§1.3). One `DELETE FROM profiles`
removes reviews, likes, collections, collection items and claims, and nulls the person
out of any listing they submitted.

**What is missing, and it is not a page:**

- **The auth schema is a separate cascade.** Better Auth's `user`, `session`, `account`
  and `verification` tables live in `auth_app` (`research/09-auth-stack-choice.md` §5.3),
  outside the `public` schema's foreign keys. `profiles.id` references
  `auth_app."user"(id) on delete cascade` in the revised design, which is right — but
  deletion has to start on the auth side or the cascade runs the wrong way. Test it.
- **The Google grant.** Deleting the row does not revoke the OAuth grant. Revoke it.
- **Third parties.** Deletion must propagate to the email sender (remove the contact) and
  Sentry (scrub user context). Sentry's own retention is fixed by plan — state that number
  in the notice rather than implying you control it.
- **Deletion versus anonymisation, decided per data type and written down.** Reviews and
  listings are contributions other people rely on. The defensible pattern is to
  **anonymise** them — detach the user id, replace the name with "Former user" — while
  **deleting** the account, email and auth material outright. But anonymisation only
  counts if re-identification is genuinely impossible; a hashed user id that still joins
  to another table is pseudonymisation, and does not discharge the obligation. Note that
  Foundit's current design **deletes** reviews on account deletion
  (`product-decisions.md` §4 and the `on delete cascade` on `reviews.author_id`), which is
  the simpler and safer choice — just make sure the page says which it is.
- **Backups.** This is the part everyone gets wrong, and the ICO's guidance is the
  clearest published answer: live systems can be cleared, backups will hold the data until
  overwritten, and the requirement is to put backup data **"beyond use"** — not used for
  any other purpose, held only until replaced on an established schedule. The ICO also
  says you must be *"absolutely clear with individuals as to what will happen to their
  data when their erasure request is fulfilled, including in respect of backup systems"*
  (<https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/>).

  So: **state the backup rotation on the deletion page** — "live deletion is immediate;
  backups roll off within N days and are never restored to reinstate a deleted account" —
  and make sure the restore procedure re-applies the deletion log. Otherwise a restore
  silently resurrects deleted users. `product-decisions.md` §10 already puts restore
  testing on the operator dashboard as a red-row item; add "does a restore re-apply
  deletions?" to what that test checks.
- **The deadline is one month** for a rights request in the EU and UK.

### 4.2 Export that is actually portable

- **JSON**, not PDF and not HTML. Foundit's data is nested — reviews inside a profile,
  items inside a collection — which is what JSON is for.
- Scope: what the person **provided** (profile, listings, reviews, collections) plus
  **observed** activity. Data Foundit **derived** — the fit scores it computed — is
  outside the portability right, though including it is allowed.
- Self-serve download, rate-limited, with an expiring link. Not "email us and wait".
- The article-level right is GDPR Art 20; the WP29/EDPB portability guidelines (WP242
  rev.01) are the interpretation, endorsed by the EDPB
  (<https://www.edpb.europa.eu/>).

### 4.3 Consent that gates the thing it claims to gate

The failure mode is a banner that fires the tracker on page load and merely *records* the
choice. If the UI claims to gate something, that thing must not load until consent is
given, and reject must be exactly as easy as accept — one click, same prominence.

Foundit's advantage here is that it has **no analytics and no ad tech** (§1.5), so the
honest answer may be that no banner is needed at all. §2 works through which of the
cookies actually present — the login session, Cloudflare's bot-management cookie, Sentry —
are exempt as strictly necessary. **Do not add a banner reflexively.** A banner asking
consent for something Foundit does under a different lawful basis, and which it will do
anyway on refusal, is worse than no banner: it is a false statement about the site's
behaviour.

Sentry is the one to look at hardest. It captures IP and user context by default. Either
configure it not to, or disclose it and gate it.

### 4.4 Unsubscribe that works

- RFC 8058 mechanics: `List-Unsubscribe` with an HTTPS URI, plus
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` exactly. The receiver sends an HTTPS
  **POST**; there must be **no confirmation page** and the POST must not be redirected. At
  least one DKIM signature must cover **both** headers.
  (<https://www.rfc-editor.org/rfc/rfc8058.html>)
- The endpoint is **unauthenticated and must be idempotent** — the mail client POSTs
  without a session. Sign the token; do not make it enumerable.
- **Honour within 48 hours** (<https://support.google.com/mail/answer/15263077>).
- Login codes are exempt from the unsubscribe requirement, but the moment one
  product-update email is sent, that stream needs the whole mechanism.

### 4.5 An abuse route a human reads — and the takedown procedure behind it

`product-decisions.md` §5 says reports go to the team by email rather than into a queue.
That is a legitimate choice at launch scale, but it is only sufficient if the behaviour
behind it exists. What has to be true:

- **Per-item reporting** on every listing and every review, with a reason taxonomy: spam,
  malware or phishing link, copyright, wrong information, fake review, abusive content.
  A footer-only "contact us" is not a notice mechanism.
- **Acknowledge the reporter**, and tell them the outcome. **Tell the author** when their
  content is removed, with the reason and an appeal route. In the EU this is not optional
  (§2, DSA Arts 16–17).
- **A written procedure**: who acts, how fast, on what grounds, and how it is recorded.
  This is what makes the hand-run takedown in §1.6 defensible rather than arbitrary.
- **Separate routes**: `security@` for vulnerabilities (§3.3), the copyright agent for
  takedowns, and a general abuse route for content. One shared inbox loses the security
  reports.
- **A fast kill switch for a malicious outbound link.** `rel="noopener noreferrer"` and
  https-only protect the browsing context; they do not protect a user from the
  destination. Because listings publish immediately, a listing pointing at a phishing site
  is live until someone acts.

### 4.6 A retention period per data type, written down

Not one vague sentence. A table, in the privacy notice:

| Data | Retention |
| --- | --- |
| Account and profile | Life of the account; deleted on request or closure |
| Login codes | Minutes, then deleted |
| Sessions and refresh tokens | Until logout or expiry |
| Reviews, likes, collections | Deleted with the account (cascade) |
| Listings submitted | Retained; the person is detached (`on delete set null`) |
| Server and access logs | State the number, e.g. 30 days |
| Sentry error events | Sentry's plan-fixed retention — state the number |
| Backups | Rotation period, then overwritten |
| `search_events` | **No user attached, ever.** State the aggregate retention |

The last row is the one worth writing carefully, because it is the strongest thing on the
page (§1.1). Users type intimate problems into that box — money, health, relationships.
Saying, specifically, that the text is stored with no link to any person and cannot be
attached to one later, is both true and unusual.

### 4.7 Two things to build carefully because they could undo §1.1

- **Rate limiting.** `.env.example` reserves `MAX_SEARCHES_PER_IP_PER_HOUR`, which is not
  implemented yet. When it is, the IP must not end up anywhere near the query text. Keep
  the counter in memory or a separate store, keyed on a salted hash with a short TTL, and
  never in the same table or the same row as a query. Getting this wrong quietly converts
  an anonymous log into an attributable one.
- **Better Auth's session table stores an IP address and a user agent.** Verified in the
  library's own source: the `session` table defines `ipAddress` and `userAgent`, both
  optional columns, alongside `token`, `expiresAt` and `userId`
  (<https://github.com/better-auth/better-auth/blob/canary/packages/core/src/db/get-tables.ts>).
  There is a switch to turn IP tracking off —
  `advanced.ipAddress.disableIpTracking` — but the library's own comment on it reads
  "⚠︎ This is a security risk and it may expose your application to abuse", because the IP
  is what rate limiting keys on
  (<https://github.com/better-auth/better-auth/blob/canary/packages/core/src/types/init-options.ts>).

  So the honest answer is: **keep it, disclose it, and bound it.** These are personal data
  and must appear in the privacy notice and in the retention table (§4.6), with the
  retention being the session lifetime. They are the one place in the whole system where
  an identifier sits beside a session — which is precisely why they must never come within
  reach of `search_events`. The library also collapses IPv6 addresses to a configurable
  prefix (`ipv6Subnet`, default /64) before rate-limit keying, which is worth knowing when
  writing the notice.

---

## 5. The day the first payment is taken

Everything here is **Not yet**, and every row shares one tripwire: **the first paid
transaction**. None of it should be built now; all of it should be read *before* the
pricing page goes live, because several items have to be designed into the checkout and
cannot be bolted on afterwards.

### 5.1 What changes the moment there is a price

The owner becomes a **trader** dealing with **consumers**, so the EU and UK pre-contract
and cancellation regimes attach in full; Israeli distance-selling disclosure puts his
legal name, ID number and a postal address on the public site; digital services to EU
consumers become taxable where the consumer is, with no small-supplier threshold for a
non-EU supplier; the free hosting tier becomes ineligible (`product-decisions.md` §11);
and the Terms become a paid contract — §7.1's last row, do not self-draft.

### 5.2 EU — MUST from the first EU sale

| Requirement | Detail |
| --- | --- |
| **CRD 2011/83 Art 6** pre-contract information <https://eur-lex.europa.eu/eli/dir/2011/83/oj> | Before the order: identity, geographic address, email, **total price inclusive of taxes**, duration and any minimum term, payment arrangements, the withdrawal right and the model withdrawal form |
| **CRD Art 8(2)** the order button | Labelled **"order with obligation to pay"** or equivalent unambiguous wording. Get it wrong and **the consumer is not bound** — the cheapest expensive mistake on this list |
| **CRD Art 8(7)** confirmation | On a **durable medium**, at the latest on delivery. An emailed receipt qualifies; a page that renders once does not |
| **CRD Arts 9–16** withdrawal | 14 days. For digital content supplied immediately the right is lost **only if** the consumer gave express prior consent, **and** acknowledged losing it, **and** you confirm that in the durable confirmation (Art 16(m), as amended by 2019/2161). Three steps, all at checkout |
| **DCD 2019/770** <https://eur-lex.europa.eu/eli/dir/2019/770/oj> | Conformity of the paid service, remedies for non-conformity, limits on modifying it afterwards. **CRD Art 6(1)(ea):** disclose any price personalised by automated decision-making |
| **VAT — non-Union OSS** <https://vat-one-stop-shop.ec.europa.eu/>; Dir 2006/112/EC <https://eur-lex.europa.eu/eli/dir/2006/112/oj> | A supplier established outside the EU registers for the **non-Union scheme** in one Member State and files one return for all of them; the Commission's guidance states no registration threshold for non-EU suppliers. Registration plus invoicing is a week's work — do not open paid accounts to EU consumers before it exists |

### 5.3 UK

- **Consumer Contracts Regulations 2013** (<https://www.legislation.gov.uk/uksi/2013/3134/contents>)
  are the CRD's shape: Sch 2 pre-contract information, **reg 14(4)** the "order with
  obligation to pay" button and the same "not bound" consequence, reg 12 durable
  confirmation, regs 29–38 the 14-day cancellation, reg 37 the digital-content exception
  with the same three-step consent-and-acknowledgement.
- **DMCC Part 4 Ch 2 subscriptions — Not yet, expected spring 2027.** DBT's consultation
  response anticipates pre-contract information in a prescribed form, **reminder notices
  before each renewal**, a **14-day cooling-off after a trial converts or a 12-month-plus
  contract auto-renews**, and cancellation as easy as sign-up, online if sign-up was
  online
  (<https://www.gov.uk/government/consultations/consultation-on-the-implementation-of-the-new-subscription-contracts-regime>).
  **Design the subscription flow to this now** and commencement is a non-event.
- UK VAT for a non-established supplier of digital services to UK consumers:
  **unverified** here — check HMRC before the first UK sale rather than assuming the EU
  answer transfers.

### 5.4 US — auto-renewal

- **California ARL, Bus. & Prof. Code §§17600–17606**
  (<https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=BPC&division=7.&part=3.&chapter=1.&article=9.>):
  renewal terms **clear and conspicuous, in visual proximity to the request for consent**;
  affirmative consent to those terms specifically; a retainable acknowledgement carrying
  the terms and the cancellation policy; and **online cancellation for anyone who signed
  up online**. **AB 2863** broadened the definitions and applies to contracts entered
  into, amended or extended on or after **1 July 2025**
  (<https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB2863>).
  Treat California as the design target; that it covers the other states is **unverified**.
- **Federal:** the FTC's negative-option "click to cancel" rule was vacated by the Eighth
  Circuit in July 2025 and FTC Act §5 still reaches deceptive renewal practices. Status
  today **unverified** — re-check <https://www.ftc.gov/legal-library/browse/rules> before
  launching a subscription.

### 5.5 Israel

- **Trader status.** The owner is *עוסק פטור*; the turnover ceiling is indexed annually and
  the current figure is **unverified** here — read it off the Tax Authority
  (<https://www.gov.il/en/departments/israel_tax_authority>) before pricing. Crossing it
  makes the registration *עוסק מורשה*: charging and remitting VAT, and issuing tax invoices.
- **Identity disclosure.** Distance-selling disclosure requires the trader's name, ID or
  company number and address (<https://www.gov.il/en/departments/consumerprotection>), so
  the first price puts the owner's legal name and a postal address on the public site.
  **Get a post box now** — the same one CAN-SPAM needs (§2.5).
- **Receipts.** One per payment. If a payment processor issues them on the owner's behalf,
  get that in writing.
- **The trap most likely to be tripped:** an email to free users saying "the paid plan is
  here" is an **advertisement** under s.30A and needs **prior consent**, not merely an
  unsubscribe link. Collect that opt-in separately at sign-up, long before it is needed.

---

## 6. International transfers and sub-processors

Foundit's data sits on one machine in Germany, so most of it never leaves the EEA. What
does leave is narrow enough to list exactly; §3.6 points here for the mechanism behind
each vendor.

### 6.1 The adequacy picture

| Route | Status | What it means for Foundit |
| --- | --- | --- |
| **EEA → Israel** | **Adequate** — Decision 2011/61/EU <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011D0061> | **The owner reading the database from Israel needs no transfer mechanism** — worth one sentence in the privacy notice. The Commission's **January 2024 review** of 11 pre-GDPR decisions found flows can continue; nothing was amended or repealed, which is why the EDPB was not formally consulted (<https://ec.europa.eu/commission/presscorner/detail/en/ip_24_161>, report COM(2024) 7 <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52024DC0007>, PPA note <https://www.gov.il/en/pages/adequacy>). **Tripwire: any Commission statement reopening it** |
| **EEA ↔ UK** | **Adequate** — Decision (EU) 2021/1772 <https://eur-lex.europa.eu/eli/dec_impl/2021/1772/oj> | Nothing to do. The decision has been extended and its current expiry is **unverified** here — check before relying on it alone. UK side: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/> |
| **EEA → US** | **Adequate only for DPF-certified recipients** — Decision (EU) 2023/1795 <https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj> | The General Court **dismissed** the annulment action in *Latombe v Commission* (T-553/23) on **3 September 2025** (<https://curia.europa.eu/site/upload/docs/application/pdf/2025-09/cp250106en.pdf>), so the framework stands today. Whether it was appealed to the Court of Justice is **unverified** — check InfoCuria before treating DPF as the only mechanism, and keep the **2021 SCCs** (Decision 2021/914, <https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj>) live in every US vendor's DPA as the fallback. Verify each vendor's DPF entry is **Active** and covers non-HR data (§3.6, caution 2) |
| **Anywhere else** | SCCs plus a transfer impact assessment | Best avoided entirely |

### 6.2 What Foundit's sub-processor list must contain

Seven columns per vendor: **legal entity · what it does · what it sees · where it
processes · transfer mechanism · its DPA · its own sub-processor page**. §3.6 carries the
last two; this is the rest.

| Vendor | What it sees | Where | Mechanism |
| --- | --- | --- | --- |
| **Hetzner Online GmbH** | Everything: database, logs, backups on that machine | Falkenstein, DE | **None needed** — intra-EEA |
| **Cloudflare** | IPs, request metadata, and — because it **terminates TLS** — request content in transit | Global edge | Customer DPA; SCCs for non-EEA legs. Say plainly that Cloudflare terminates TLS and sees traffic in the clear at the edge; a notice implying end-to-end encryption to the VPS is wrong |
| **The email sender** (Resend / Postmark / SES — §3.6) | Email address, the login code, delivery metadata | US or EU by configuration | DPF and/or SCCs via their DPA. **Pick the EU region where one is offered** |
| **Sentry** | Stack traces, IP, whatever user context is configured | US unless provisioned in the EU region | §3.6 caution 1: provision EU, or say in the notice that error data goes to the US |
| **Google LLC** (sign-in) | Account identifier, email and profile name of anyone using Google sign-in | US | Google's DPA + DPF. This is a disclosure **to a separate controller**, not a pure processor relationship |
| **OpenAI** (embeddings) | **The text the user typed** | US, unless an EU data-residency option is used | SCCs and/or DPF via their DPA — §6.3 |

### 6.3 The one that needs its own paragraph: the search text leaves the server

The item most likely to be missed, and it partly cuts against §1.1. Foundit stores search
text with nothing attached to a person — but to compute a fit score it **sends that text
to an embeddings API**. So the text **crosses a border and reaches a US processor** even
though the database never does, and the call carries Foundit's key and the request's
network metadata, so the provider sees an IP and a timestamp **alongside the text** even
though Foundit stores neither.

The notice therefore **cannot** say "your search never leaves our server". It can say
something better and true: *the text is sent to a model provider to compute the match,
under a data-processing agreement, is not used to train their models, and is stored by
Foundit with no link to any person.* **Verify the no-training term in the provider's
current API data-usage policy and cite that page** — if the term is not in the contract,
drop the claim. Users type money, health and relationship problems into that box (§4.6);
the gap between "we keep nothing attributable" and "nothing leaves" is exactly the gap a
journalist finds. **If the fit score is ever computed by a model on the Falkenstein
machine this whole paragraph disappears** — a real privacy argument for a local embedding
model, worth weighing when the cost numbers are next revisited.

**Rating: MUST.** GDPR Art 13(1)(e)–(f) require the recipients or categories of recipients
and the fact of a third-country transfer with the safeguard relied on. A privacy notice
that omits the embeddings provider is not thin — it is inaccurate.

### 6.4 Ratings and tripwires

| Item | Rating | Tripwire |
| --- | --- | --- |
| Transfer mechanism recorded per vendor in the records of processing; the embeddings provider named in the notice as a recipient and a transfer; Cloudflare's TLS termination described honestly | **MUST** now | — |
| Public sub-processor page (§3.6) | **SHOULD** now | **MUST** at the first business customer or the first DPA request |
| Transfer impact assessment for the US vendors | **SHOULD** | Any vendor whose DPF entry is inactive or does not cover non-HR data |
| Re-check DPF status and the *Latombe* appeal | **MUST**, annually | An appeal judgment, or any Commission suspension |
| Sub-processor change notices actually read | **SHOULD** | Sentry gives 30 days, Resend 14, Postmark 7 (§3.6) — a change nobody reads is a transfer nobody disclosed |

---

## 7. What genuinely needs a lawyer

Being direct about this, as asked. Most of the list in this document can be written by
the owner from a good template and a clear head. A short, specific set cannot, and the
reason is always the same: the text creates or limits a legal relationship, and getting
it wrong is worse than not having it.

### 7.1 Needs a lawyer — do not use a template unread

| Item | Why |
| --- | --- |
| **Terms of Service** | This is a contract. It sets the licence users grant over their reviews and listings, the limitation of liability, the indemnity, the governing law and forum, the termination rights, and the DSA Art 14 content that has to sit inside it. A template written for a US SaaS company will pick the wrong governing law and will not contain the DSA clauses at all. It is also the document that decides, if a maker sues over a bad review, whether Foundit is a defendant or a witness. |
| **The governing-law and jurisdiction clause specifically** | An Israeli individual, a German server, EU and UK and US users. Consumer-protection law in the EU and UK overrides a choice of law for consumers in many respects, so a naive "governed by the laws of Israel" clause is partly unenforceable and knowing *which* part is a lawyer's job. |
| **Whether an EU Art 27 representative and a DSA Art 13 legal representative are needed** | §0.1. This turns on a fact pattern — an Israeli natural person operating a German server serving EU users — that the guidance does not cleanly resolve. Both representatives cost real money, so it is worth an hour of advice rather than guessing in either direction. Guessing "no" is the expensive error: the DSA representative can be held liable for non-compliance. |
| **The liability position for user-generated content** | Three regimes, three different answers, and the one that matters most (Israel) has no statutory safe harbour — it is case law. Foundit publishes immediately with no queue, which is a defensible choice but one that needs to be defensible *in the terms*, not just in a design document. |
| **Anything drafted after the first payment is taken** | Consumer contract terms, cancellation and refund rights, and auto-renewal disclosures are heavily prescribed and differ by jurisdiction. Do not launch paid accounts on a self-written page. |

### 7.2 A lawyer should review, but the owner should write the first draft

- **The privacy notice.** The owner knows what the system does; the lawyer knows what
  the notice must say. Writing it in-house first produces a truthful notice and a much
  cheaper review. The honest, specific claims Foundit can make (§1.1) will be lost if a
  lawyer writes it from a template.
- **Community Guidelines / content policy.** Substance is a product decision. A lawyer
  should check that it lines up with the terms and does not promise more moderation than
  Foundit actually performs.
- **The notice-and-action and appeals wording.** Product copy, legal skeleton.

### 7.3 Does not need a lawyer

About, Contact, Accessibility statement, security.txt, the sub-processor list, the "how
the fit score works" page, the changelog, the help pages, and every internal record
(records of processing, retention schedule, breach log, risk assessment). These are
descriptions of fact. A lawyer adding words to them makes them worse.

### 7.4 What kind of lawyer, and when

One Israeli lawyer who practises technology and privacy, and who can either advise on EU
law or refer it. The efficient moment is **once, just before launch**, with this document
and a draft of the Terms and privacy notice in hand — not now, and not after the first
complaint. The three questions worth paying for are: the representative question (§0.1),
the governing-law clause, and the UGC liability position.
