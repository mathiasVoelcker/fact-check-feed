# rating-classification Specification

## Purpose
Defines how free-form rating text written by fact-checkers is converted into a comparable category and severity score, so that later features can prioritize negatively rated claims regardless of publisher wording or language.

## Requirements
### Requirement: Category and severity per rating
For each stored record the system SHALL assign its rating text a category from the fixed set false, misleading, mixed, true, unproven, or unclassifiable, and a severity between 0 and 1 inclusive. The severity SHALL be higher for more negative verdicts, and a record in the unclassifiable category SHALL have no severity value.

#### Scenario: Clear false rating
- **WHEN** the rating text is "False"
- **THEN** the category is false
- **AND** the severity is the highest in the false and misleading range

#### Scenario: Negative ratings outrank neutral ones
- **WHEN** one record is rated "Misleading" and another "True"
- **THEN** the misleading record has a higher severity than the true record

#### Scenario: Unclassifiable rating
- **WHEN** the rating text cannot be mapped to any category with confidence
- **THEN** the category is unclassifiable
- **AND** the record has no severity value

### Requirement: Negative ratings are identifiable
The system SHALL treat the categories false and misleading as negative, and SHALL expose a record's negativity so that consumers can filter and sort by it.

#### Scenario: False and misleading are negative
- **WHEN** a record's category is false or misleading
- **THEN** the record is marked negative

#### Scenario: Other categories are not negative
- **WHEN** a record's category is mixed, true, unproven or unclassifiable
- **THEN** the record is not marked negative

### Requirement: Free-form and multilingual rating text
The system SHALL classify rating text regardless of its wording: short labels, labels in other languages, bilingual labels such as "பொய் / False", and sentences that include an explanation after a verdict.

#### Scenario: Bilingual label
- **WHEN** the rating text is "අසත්‍යයි / False"
- **THEN** the category is false

#### Scenario: Verdict followed by explanation
- **WHEN** the rating text is "DW Fact check: Misleading The video is old and unrelated to the current developments."
- **THEN** the category is misleading

#### Scenario: Explanation without a verdict
- **WHEN** the rating text is a sentence that argues about the claim but states no verdict
- **THEN** the category is unclassifiable or reflects only a verdict that is clearly stated

### Requirement: Classification is cached per rating text
The system SHALL classify each distinct rating text once and reuse the stored result for every record with the same rating text, within and across runs.

#### Scenario: Same text classified once
- **WHEN** an ingestion run contains 50 records whose rating text is "False"
- **THEN** the classifier is asked to classify "False" at most once

#### Scenario: Known text is not reclassified in a later run
- **WHEN** a later run contains a rating text that was classified in an earlier run
- **THEN** the stored result is used
- **AND** the classifier is not asked again

### Requirement: Classifier failure does not block ingestion
If classification of a rating text fails, the system SHALL still store the record, with the category unclassifiable, SHALL NOT cache that failed result, and SHALL report the number of failures for the run.

#### Scenario: Classifier unavailable
- **WHEN** the classifier cannot be reached during a run
- **THEN** records with unclassified rating texts are stored with category unclassifiable
- **AND** the run reports the number of classification failures

#### Scenario: Failed result is retried later
- **WHEN** a rating text failed to classify in one run and the classifier is available in the next run
- **THEN** the text is classified in the next run

### Requirement: Only rating text is sent to the classifier
The system SHALL send only the distinct rating text to the classifier. It SHALL NOT send claim text, article URLs or publisher names.

#### Scenario: Classifier input
- **WHEN** a rating text is sent for classification
- **THEN** the request contains that rating text and no claim text, URL or publisher name
