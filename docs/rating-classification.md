# Rating classification

Fact-checkers word their verdicts freely ("False", "பொய் / False", a whole sentence). Ingestion turns each distinct
rating text into a **category** and a **severity** so that the feed can filter by rating category (and later sort by how negative a
verdict is), whatever the publisher's wording or language. The feed also words the label on a claim's origin by category
(`src/feed/origin-label.ts`), so a claim is only called false when its category is `false`.

## Categories

Every stored claim has exactly one category, from this fixed set:

| Category         | Meaning                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `false`          | Stated to be false, fake, fabricated or a hoax                                    |
| `misleading`     | Misleading, missing context, out of context, exaggerated or manipulated          |
| `mixed`          | Partly true and partly false                                                      |
| `true`           | Stated to be true, correct or accurate                                            |
| `unproven`       | Unverified or lacking evidence, and not stated to be false                        |
| `unclassifiable` | No clear verdict, or the classifier was not confident, or classification failed  |

The **negative** categories are `false` and `misleading`. Negativity is derived from the category (`isNegative` in
`src/classification/negative.ts`) and is not stored, so there is one source of truth.

## Severity

Severity is a number from 0 to 1 that is higher the more negative the verdict is. Typical values: `false` 0.9 to 1.0
(a plain "False" is 1.0), `misleading` 0.6 to 0.8, `mixed` 0.4 to 0.5, `unproven` 0.2 to 0.3, `true` 0.0 to 0.1.

`unclassifiable` has **no** severity: it is stored as `null`, never as 0. Any other category must have a severity.
An answer that breaks these rules is treated as a failed classification.

## How a rating text is classified

1. The text is cut to 300 characters (`MAX_RATING_LENGTH`). The cut text is the cache key and is all the classifier sees.
2. Each distinct text is looked up in `rating_classifications`. A stored result is reused when it was produced by the
   current classifier version.
3. Texts that are not cached are sent to the classifier in batches. Only the rating text is sent: never the claim,
   the URL or the publisher.
4. Valid answers are stored. A text that fails (request error, refusal, truncated or invalid answer) is stored on the
   claim as `unclassifiable` for this run, is **not** cached, and is retried by the next run. The run report counts the
   failures.

## The classifier

The classifier is `src/classification/gemini.ts`. It uses `gemini-3.5-flash-lite` with structured JSON output
(a Zod schema converted to a JSON schema), and its current version string is `gemini:gemini-3.5-flash-lite:prompt-v1`. The version is stored in
`rating_classifications.classifier_version`.

### Changing the model or the prompt

1. Edit `CLASSIFIER_MODEL` or the system prompt in `src/classification/gemini.ts`.
2. If the change can alter any answer, bump `PROMPT_VERSION` in the same file. The new version string makes every
   cached row stale: each distinct rating text is classified again on the next run and its row is replaced.
3. Do not bump it for a change that cannot alter answers (comments, batching, logging).
4. Run `npm test`. The tests use a fake client and recorded answers, never the real API.

If the cached answers must be redone without a code change, delete the rows: `DELETE FROM rating_classifications;`.
They are rebuilt on the next run.

### Testing

No test calls a model. The classifier is given a client object, and tests pass a fake one that replays answers
(`tests/fixtures/classifier-responses.json`), most of them recorded from the real model. The real client is built only by the ingest script.
