# Spec Delta

## Purpose

Defines how a weekly run turns the Data Commons ClaimReview feed into a database of recent, English-language fact-check records, including which records are kept, what is stored for each, and how repeated runs behave.

## ADDED Requirements

### Requirement: Weekly full-snapshot ingestion
The system SHALL support an ingestion run that downloads the complete feed snapshot, processes every review in it, and stores the qualifying records. A run SHALL be startable on a weekly schedule and on demand.

#### Scenario: Successful run
- **WHEN** an ingestion run is started and the feed is downloaded successfully
- **THEN** every review in the snapshot is evaluated against the filters
- **AND** the qualifying records are stored
- **AND** the run reports counts of reviews read, stored, and excluded per reason

#### Scenario: Download failure leaves data unchanged
- **WHEN** the feed download fails or the content is not a valid feed
- **THEN** the run fails with an error
- **AND** no stored records are changed

#### Scenario: Honest identification
- **WHEN** the feed is requested
- **THEN** the request identifies the application with a descriptive user-agent

### Requirement: Stored fields are limited
Each stored record SHALL contain only the claim text, the rating text, the publisher name, the review date, the URL of the original fact-check, and the source reference. The system SHALL NOT store article bodies or any other content from the feed or from publisher sites.

#### Scenario: Only permitted fields are stored
- **WHEN** a review is stored
- **THEN** the stored record has exactly the permitted fields
- **AND** no other feed field, such as explanations, images or appearance links, is persisted

#### Scenario: Publisher site is never contacted
- **WHEN** an ingestion run completes
- **THEN** no request has been made to any host other than the feed host

### Requirement: Publisher name is kept as provided
The system SHALL store the publisher name exactly as it appears in the feed, without merging or rewriting variants.

#### Scenario: Name variants stay distinct
- **WHEN** the feed contains reviews by "Fact Crescendo" and by "Fact Crescendo Sri Lanka"
- **THEN** both names are stored unchanged as separate values

### Requirement: Required fields must be present
The system SHALL exclude a review that has no claim text, no URL, no publisher name, or no rating text, and SHALL count it under its exclusion reason.

#### Scenario: Missing claim text
- **WHEN** a review has an empty or missing claim text
- **THEN** it is not stored
- **AND** it is counted as excluded for missing claim text

#### Scenario: Missing URL
- **WHEN** a review has no URL
- **THEN** it is not stored
- **AND** it is counted as excluded for missing URL

#### Scenario: Missing rating text
- **WHEN** a review has an empty or missing rating text
- **THEN** it is not stored
- **AND** it is counted as excluded for missing rating text

### Requirement: Review date validity
The system SHALL use the review's published date for all date rules. It SHALL exclude a review whose published date is missing or cannot be parsed as a valid calendar date, and SHALL reject a review whose published date is later than the run date. There SHALL be no fallback to any other date.

#### Scenario: Missing date is excluded
- **WHEN** a review has no published date
- **THEN** it is not stored
- **AND** it is counted as excluded for invalid date

#### Scenario: Unparseable date is excluded
- **WHEN** a review has a published date that is not a valid date
- **THEN** it is not stored
- **AND** it is counted as excluded for invalid date

#### Scenario: Future date is rejected
- **WHEN** a review has a published date later than the day of the run
- **THEN** it is not stored
- **AND** it is counted as rejected for future date

#### Scenario: Date of the run day is accepted
- **WHEN** a review has a published date equal to the day of the run
- **THEN** the date rule does not exclude it

### Requirement: Rolling 90-day window
The system SHALL store only reviews whose published date is within the 90 days up to and including the run date. Reviews older than that SHALL be excluded, and previously stored records that have fallen outside the window SHALL be removed.

#### Scenario: Review inside the window
- **WHEN** a review is published 89 days before the run date
- **THEN** it is eligible for storage

#### Scenario: Review outside the window
- **WHEN** a review is published 91 days before the run date
- **THEN** it is not stored
- **AND** it is counted as excluded for being outside the window

#### Scenario: Aged-out records are removed
- **WHEN** a run completes and a stored record's published date is now more than 90 days before the run date
- **THEN** that record is removed from storage

### Requirement: English-only filter
The system SHALL keep only reviews whose claim text is detected as English, and SHALL perform the detection deterministically without calling any language model or external service.

#### Scenario: English claim is kept
- **WHEN** a review's claim text is in English
- **THEN** the language rule does not exclude it

#### Scenario: Non-English claim is excluded
- **WHEN** a review's claim text is in a language other than English, for example Persian or Sinhala
- **THEN** it is not stored
- **AND** it is counted as excluded for language

#### Scenario: Language of the rating text is irrelevant
- **WHEN** a review has an English claim text and a bilingual rating text such as "பொய் / False"
- **THEN** the language rule does not exclude it

#### Scenario: Detection is repeatable
- **WHEN** the same claim text is evaluated twice
- **THEN** the result is the same both times
- **AND** no network request is made for the evaluation

### Requirement: Upsert by article URL
The system SHALL identify a stored record by the URL of the original fact-check. A review whose URL is already stored SHALL update that record, and a review with a new URL SHALL create a new record. When one run contains several reviews with the same URL, exactly one record SHALL be stored for that URL: the last one in the snapshot. Each superseded review SHALL be counted as excluded for duplicate URL, so that the reviews read always equal the records stored plus the reviews excluded.

#### Scenario: New URL creates a record
- **WHEN** a qualifying review has a URL that is not stored
- **THEN** a new record is created

#### Scenario: Existing URL updates the record
- **WHEN** a qualifying review has a URL that is already stored with a different rating text
- **THEN** the stored record is updated to the new values
- **AND** no second record is created

#### Scenario: Same URL twice in one run
- **WHEN** two qualifying reviews in one snapshot share a URL
- **THEN** exactly one record exists for that URL after the run
- **AND** it holds the values of the later review
- **AND** the earlier review is counted as excluded for duplicate URL

#### Scenario: Re-running the same snapshot is idempotent
- **WHEN** a run is repeated with an identical snapshot
- **THEN** the stored records are the same as after the first run

### Requirement: Run is atomic
A run SHALL apply its changes (inserts, updates and removals) as a single unit, so that a failure partway through leaves the previously stored records intact.

#### Scenario: Failure during storage
- **WHEN** storing records fails partway through a run
- **THEN** none of the run's changes are visible
- **AND** the previously stored records are unchanged

### Requirement: Malformed entries do not stop the run
The system SHALL skip a feed entry that cannot be interpreted as a review, count it under its own reason, and continue with the remaining entries.

#### Scenario: One malformed entry
- **WHEN** one entry in the snapshot has an unexpected structure
- **THEN** it is counted as excluded for being malformed
- **AND** the other entries are processed normally
