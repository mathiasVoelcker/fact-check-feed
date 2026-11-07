# Spec Delta

## Purpose

Defines the registry of data sources the system is permitted to read, with each source's access method, license and attribution requirement, so that legal constraints are checked by the system and not left to convention.

## ADDED Requirements

### Requirement: Allowlist entry fields
Every source in the allowlist SHALL record a source identifier, its access method (one of API, RSS, bulk, page), its license, whether attribution is required, the attribution text, and the source URL.

#### Scenario: Complete entry is accepted
- **WHEN** the allowlist is loaded and an entry has all required fields with a valid access method
- **THEN** the entry is accepted

#### Scenario: Entry with a missing field is rejected
- **WHEN** an entry lacks its license or its access method
- **THEN** loading the allowlist fails with an error naming the entry and the missing field

#### Scenario: Unknown access method is rejected
- **WHEN** an entry declares an access method other than API, RSS, bulk or page
- **THEN** loading the allowlist fails with an error naming the entry

### Requirement: Data Commons feed is the only allowlisted source
The allowlist SHALL contain exactly one entry for this release: the Data Commons ClaimReview feed, with access method bulk, license CC BY 4.0, attribution required, and the feed URL.

#### Scenario: Initial allowlist content
- **WHEN** the allowlist is loaded
- **THEN** it contains the Data Commons ClaimReview feed with access method bulk and license CC BY 4.0
- **AND** it contains no other entry

### Requirement: Ingestion reads only allowlisted sources
The system SHALL refuse to ingest from any source that is not in the allowlist, and SHALL fetch a source only through the access method recorded for it.

#### Scenario: Unlisted source is refused
- **WHEN** ingestion is started for a source identifier that is not in the allowlist
- **THEN** no network request is made
- **AND** the run fails with an error stating that the source is not allowlisted

#### Scenario: Listed source is fetched by its recorded method
- **WHEN** ingestion is started for the Data Commons feed
- **THEN** the feed is fetched as a bulk download from the URL recorded in its allowlist entry

### Requirement: Attribution travels with the data
Every stored record SHALL be traceable to its allowlisted source, so that a consumer can display the source's required attribution text for it.

#### Scenario: Record carries its source
- **WHEN** a record is stored by ingestion
- **THEN** the record references the source identifier of the allowlist entry it came from

#### Scenario: Attribution text is retrievable
- **WHEN** a consumer looks up the allowlist entry for a stored record's source
- **THEN** it obtains the license and the attribution text to display
