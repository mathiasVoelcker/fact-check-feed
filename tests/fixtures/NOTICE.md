# Test fixture notice

`claimreview-sample.json` is a small selection of reviews trimmed from the Google Data Commons ClaimReview feed
(https://storage.googleapis.com/datacommons-feeds/claimreview/latest/data.json, snapshot of 2026-11-02).

The data comes from Data Commons (datacommons.org/factcheck) and is licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). Each review links to the original fact-check by its publisher; the
reviews remain the work of those publishers.

## How it is used

Automated tests run against this file and never request the live feed. The reference run date for every test that
uses it is **2026-11-02**.

## What was changed

Most entries are unmodified reviews from the feed. These entries were derived from a real review by changing exactly
one field, because the real feed has no suitable example:

| Edge case | Change | Claim text starts with |
| --- | --- | --- |
| Missing URL | `url` removed | "Video shows fish swimming in floodwater" |
| Impossible calendar date | `datePublished` set to `2026-02-30` | "French police deployed a unit of pigs" |
| Future date, one day after the run date | `datePublished` set to `2026-11-03` | "The Supreme Court awarded Sara Duterte" |
| Run-day date | `datePublished` set to `2026-11-02` | "A video shows the last rites of Kawant" |
| Bilingual rating on an English claim | rating set to `பொய் / False` | "A video shows Indian and Chinese troop" |
| Bilingual rating on an English claim | rating set to `අසත්‍යයි / False` | "The Central Bank of Sri Lanka has intr" |
| Sentence rating without a verdict | rating set to a sentence stating no verdict | "The video shows residents of Arunachal" |
| Publisher name variant | publisher set to `Fact Crescendo` | "President Anura Kumara Dissanayake was" |

Two pairs of real reviews share a URL because one article reviews several claims (a Fact Crescendo Sri Lanka article
about the Buddha Sasana Minister, and a Deutsche Welle article about a laboratory worker's death). They are the
multi-claim case recorded as a known limitation in design D8.

The last element of the file contains the string `"not-a-review"` in place of a review. It stands in for a malformed
entry.

## Language fixture

`language-labeled.json` holds 165 claim texts taken unchanged from the same feed (CC BY 4.0, see above), each labeled
with whether it is English (`english`) and with a `language` tag. English claims are split into short (under 50
characters), medium and long (150 or more). The non-English claims cover Persian or Arabic, Sinhala, Tamil, Telugu,
Devanagari, Bengali, Thai, CJK and Cyrillic scripts plus Spanish, Portuguese, German, French, Indonesian, Tagalog and
Swahili. The claims were chosen by script and word lists, not by the language-detection library under test, and the
Latin-script labels were checked by hand. The accuracy test in `tests/language.test.ts` uses it to choose and check the
detection library (design D9).
