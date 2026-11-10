## MODIFIED Requirements

### Requirement: Stored fields are limited
Each stored record SHALL contain only the claim text, the rating text, the publisher name, the review date, the URL of the original fact-check, the source reference, and optionally the rating explanation. The system SHALL NOT store article bodies or any other content from the feed or from publisher sites.

#### Scenario: Only permitted fields are stored
- **WHEN** a review is stored
- **THEN** the stored record has exactly the permitted fields
- **AND** no other feed field, such as images or appearance links, is persisted

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
