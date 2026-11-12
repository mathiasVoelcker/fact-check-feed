## MODIFIED Requirements

### Requirement: Stored fields are limited
Each stored record SHALL contain only the claim text, rating text, publisher name, review date, URL of the original fact-check and source reference, and optionally the rating explanation, the original-claim URL, and the original claim's venue and author name. The system SHALL NOT store article bodies or any other content from the feed or from publisher sites.

#### Scenario: Only permitted fields are stored
- **WHEN** a review is stored
- **THEN** the stored record has exactly the permitted fields
- **AND** no other feed field, such as images or further appearance links, is persisted

#### Scenario: Publisher site is never contacted
- **WHEN** an ingestion run completes
- **THEN** no request has been made to any host other than the feed host

## ADDED Requirements

### Requirement: Rating explanation is optional and capped
The system SHALL store the review's rating explanation, the text the publisher gives for the rating, when the feed provides a non-blank one, and SHALL store nothing for it otherwise. A review without an explanation SHALL NOT be excluded. A stored explanation SHALL be at most 1000 characters; a longer one SHALL be cut at a word boundary and end with an ellipsis. The explanation SHALL NOT be sent to the rating classifier.

#### Scenario: Explanation is stored
- **WHEN** a qualifying review has a rating explanation of 1000 characters or fewer
- **THEN** the stored record holds that explanation unchanged

#### Scenario: Missing or blank explanation
- **WHEN** a qualifying review has no rating explanation, or one that is blank
- **THEN** the record is stored with no explanation
- **AND** the review is not counted as excluded

#### Scenario: Long explanation is cut
- **WHEN** a qualifying review has a rating explanation longer than 1000 characters
- **THEN** the stored explanation is at most 1000 characters
- **AND** it is a prefix of the original ending at a word boundary, followed by an ellipsis

#### Scenario: Explanation follows the feed on re-run
- **WHEN** a URL that is already stored is ingested again with a different explanation
- **THEN** the stored explanation is replaced

#### Scenario: Removed explanation is cleared
- **WHEN** a URL that is already stored with an explanation is ingested again without one
- **THEN** the stored record has no explanation

#### Scenario: Explanation never reaches the classifier
- **WHEN** a run classifies rating texts
- **THEN** the classifier receives rating texts only, never a rating explanation

### Requirement: Original-claim URL is optional and never requested
The system SHALL store the URL where the claim appeared when the feed gives one: the first appearance's URL if present, otherwise the first listed appearance's. A value that is not an absolute http(s) URL SHALL count as missing. A review without one SHALL NOT be excluded, and the system SHALL NOT request the stored URL.

#### Scenario: First appearance is preferred
- **WHEN** a qualifying review has both a first appearance URL and listed appearance URLs
- **THEN** the stored original-claim URL is the first appearance's

#### Scenario: Listed appearance is the fallback
- **WHEN** a qualifying review has several listed appearance URLs and no first appearance
- **THEN** the stored original-claim URL is the first listed one

#### Scenario: Unsafe or malformed URL is treated as missing
- **WHEN** the only appearance URL of a qualifying review is not an absolute http(s) URL, such as a script or relative link
- **THEN** the record is stored with no original-claim URL
- **AND** the review is not counted as excluded

#### Scenario: Missing original-claim URL
- **WHEN** a qualifying review lists no appearance
- **THEN** the record is stored with no original-claim URL
- **AND** the review is not counted as excluded

#### Scenario: Original-claim URL is never requested
- **WHEN** an ingestion run stores records that have an original-claim URL
- **THEN** no request has been made to the host of any stored original-claim URL

#### Scenario: Origin follows the feed on re-run
- **WHEN** a URL that is already stored is ingested again with a different or missing original-claim URL, venue or author name
- **THEN** each stored value is replaced, or cleared when the feed no longer has it

### Requirement: Original claim venue and author are optional and capped
The system SHALL store the venue and the author name of the original claim when the feed provides a non-blank value, and nothing otherwise. Each SHALL be at most 200 characters; a longer one SHALL be cut at a word boundary and end with an ellipsis. A review without them SHALL NOT be excluded, and neither SHALL be sent to the rating classifier.

#### Scenario: Venue and author are stored
- **WHEN** a qualifying review has a venue and an author name of 200 characters or fewer
- **THEN** the stored record holds both unchanged

#### Scenario: Missing or blank venue and author
- **WHEN** a qualifying review has no venue or author name, or only blank ones
- **THEN** the record is stored without them
- **AND** the review is not counted as excluded

#### Scenario: Long venue or author is cut
- **WHEN** a qualifying review has a venue or author name longer than 200 characters
- **THEN** the stored value is at most 200 characters
- **AND** it is a prefix of the original ending at a word boundary, followed by an ellipsis
