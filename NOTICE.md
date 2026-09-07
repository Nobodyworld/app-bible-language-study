# Bundled Data Notice

The bundled Bible and study data was prepared from the OpenBible.com
downloadable application archive `openbible.zip` (SHA-256
`5873f5a28ceb3cb760cc0dcaa9b9d28ffaf00595bad0c424b60c7f1ad56283fe`)
and supplemental translation material in `bibles.xlsx`. The downloaded package
identifies OpenBible.com as a production of Bible Hub.

OpenBible's package terms state that the majority of its content and code is
provided under CC0 and may be copied, adapted, and shared commercially or
noncommercially, with or without attribution. Those terms also require
source-attached copyright notices to be retained and the associated Bible text
not to be modified. The following attached notices are preserved exactly:

> The Berean Bible (www.Berean.Bible) Berean Study Bible (BSB) © 2016, 2020 by Bible Hub and Berean.Bible. Used by Permission. All rights Reserved. Free downloads and licensing available.

> Text courtesy of BibleProtector.com. Section Headings Courtesy Berean Study Bible.

> This text of God's Word has been dedicated to the public domain. Free resources and databases are available at BereanBible.com.

The BSB-related notices are intentionally retained together. The package
contains historical permission/copyright notice text and a later statement that
the text has been dedicated to the public domain. This repository preserves
both source-attached statements as provenance instead of replacing them with a
single legal conclusion.

The original package also identifies its search scripts as created with
ZoomSearchEngine by Passmark Software and requires their copyright notices to
be retained. Those scripts are not included in this repository; the app uses
its own generated JSON search indexes.

Source material was transformed into JSON verse and study records, search
indexes, graph data, interlinear records, and analysis files. The MIT License
applies to the application code, tests, scripts, schemas, and tooling, not to
third-party bundled data.

The original-language verse datasets are reproducibly extracted from the
archive's `wlc`, `wlco`, `nestle`, and `tr94` XHTML directories into
`app/data/verses/<source-id>`. The transformation removes page navigation and
markup, preserves only nonempty Hebrew or Greek source text, and normalizes the
result to Unicode NFC. It does not substitute transliteration or English text.
Coverage and source-specific paths are recorded in
`app/data/source-manifest.json`. The source pages identify the texts as the
Westminster Leningrad Codex, WLC Consonants Only, Nestle Greek New Testament
1904, and Scrivener's Textus Receptus 1894; no additional rights conclusion is
asserted beyond the archive terms preserved above.

The maintained transformation authority is
`app/tools/import-original-language-sources.mjs`, including the current-schema
Strong's verse-word and lexicon JSONL transformations reconciled from historical
tooling. Historical extracts are not interchangeable with the current packaged
corpus: matching reviewed source revisions are required for regeneration.
`app/tools/generate-search-indexes.mjs` derives current exact Search postings
from the packaged canonical records and records deterministic input/output
digests and counts in the Search manifest. These derived indexes do not replace
source rights or text/lemma/morphology/alignment authority. Reproduction commands,
no-write checks and limitations are documented in
[`docs/SOURCE_SEARCH_GENERATION.md`](docs/SOURCE_SEARCH_GENERATION.md).

Public repository visibility does not relicense bundled third-party data. This
notice records source provenance, retained terms, and transformations rather
than asserting one blanket license for the complete data package. Anyone
redistributing bundled content must review this file together with
`app/data/source-manifest.json` and retain all applicable source-attached
notices.

The software and bundled data are provided as-is, without warranty.
