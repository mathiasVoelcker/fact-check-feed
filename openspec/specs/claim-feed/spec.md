# claim-feed Specification

## Purpose
Defines the public feed page that lists stored fact-checks as cards: what each card shows, how a claim's origin is labeled as the content being checked and never as a source, how the list is ordered, paginated, searched and filtered, and the attribution the page carries.

## Requirements

### Requirement: Feed lists stored claims newest first
The feed page SHALL list the stored claims read from the database, ordered by review date, newest first, with a fixed tie-break so the order is stable. The page SHALL NOT offer a control to change the order.

#### Scenario: Newest first
- **WHEN** the feed is opened and the database holds claims with different review dates
- **THEN** the cards appear from the most recent review date to the oldest

#### Scenario: Same date keeps a stable order
- **WHEN** several claims share a review date
- **THEN** they appear in the same order on every load and in every page

#### Scenario: No sort control
- **WHEN** the feed is opened
- **THEN** it offers no control for sorting or ranking the list

#### Scenario: Empty database
- **WHEN** the feed is opened and no claims are stored
- **THEN** the page says there are no fact-checks yet and shows no cards

### Requirement: Card content
Each card SHALL show the rating category as a badge together with the publisher's rating text, the claim text, the publisher name, the review date and a link to the original fact-check. It SHALL show the publisher's rating explanation when one is stored. It SHALL NOT show any other stored or derived field, and SHALL NOT show article text.

#### Scenario: Full card
- **WHEN** a claim with an explanation is shown
- **THEN** its card shows the category badge, the rating text, the claim, the explanation, the publisher, the date and the fact-check link

#### Scenario: Card without an explanation
- **WHEN** a claim without an explanation is shown
- **THEN** its card has no explanation block
- **AND** the fact-check link says where to read the publisher's reasoning

#### Scenario: Fact-check link
- **WHEN** a card is shown
- **THEN** the fact-check link points to the stored fact-check URL, opens in a new tab and carries rel="noopener noreferrer"

### Requirement: Claim origin is labeled as the claim being checked
When a claim has an original URL, venue or author, its card SHALL show them in a block next to the rating, labeled in plain words as the claim as it was posted and never as a source, reference or "read more". The wording SHALL depend on the rating category: for "false" it SHALL say the claim is false, for "misleading" that it is misleading, and for every other category it SHALL NOT call the claim false or misleading. The block SHALL NOT be shown without the rating on the same card.

#### Scenario: Claim rated false
- **WHEN** a card for a claim whose category is "false" has an origin
- **THEN** the origin block says it is the false claim itself and not a source

#### Scenario: Claim rated misleading
- **WHEN** a card for a claim whose category is "misleading" has an origin
- **THEN** the origin block says it is the misleading claim itself and not a source

#### Scenario: Claim not rated false or misleading
- **WHEN** a card for a claim whose category is "true", "mixed", "unproven" or "unclassifiable" has an origin
- **THEN** the origin block says it is the claim that was checked and not a source
- **AND** the block does not use the words false or misleading about the claim

#### Scenario: Origin shown with the rating
- **WHEN** a card shows an origin block
- **THEN** the same card shows the rating badge and rating text

#### Scenario: Card without origin
- **WHEN** a claim has no original URL, venue or author
- **THEN** its card has no origin block

### Requirement: Original-claim link is safe and does not look ordinary
A link to the original claim SHALL be shown only when the stored original URL is an absolute http or https URL. It SHALL carry rel="noopener noreferrer nofollow", open in a new tab, be visually distinct from the fact-check link and show the host name with a warning marker instead of the full URL. The system SHALL NOT request the original URL.

#### Scenario: Link attributes
- **WHEN** a card shows an original-claim link
- **THEN** the link has rel="noopener noreferrer nofollow" and target="_blank"
- **AND** the link text is the host name with a warning marker, not the full URL

#### Scenario: Not an ordinary link
- **WHEN** a card shows both the fact-check link and an original-claim link
- **THEN** the two links are marked differently, and only the fact-check link is presented as the place to read more

#### Scenario: Unsafe URL is not linked
- **WHEN** a stored original URL is not an absolute http or https URL
- **THEN** the card shows no link for it

#### Scenario: Original URL is never requested
- **WHEN** the feed is rendered and further pages are served
- **THEN** the system makes no request to any original-claim URL or publisher site

### Requirement: Cards load in pages as the reader scrolls
The feed SHALL show the first 50 matching claims and load the next 50 when the reader scrolls near the end of the list, until all matching claims are shown. It SHALL show no claim twice and skip none, also when claims are added between page loads.

#### Scenario: First page
- **WHEN** the feed is opened and more than 50 claims match
- **THEN** exactly 50 cards are shown

#### Scenario: Next page
- **WHEN** the reader scrolls near the end of the shown cards and more claims match
- **THEN** the next 50 matching claims are added after the shown ones

#### Scenario: Last page
- **WHEN** all matching claims are shown
- **THEN** no further page is requested and no loading marker remains

#### Scenario: No duplicates or gaps
- **WHEN** every page of the same query is read in turn
- **THEN** each matching claim appears exactly once

#### Scenario: New claim between pages
- **WHEN** a claim newer than all shown ones is stored after the first page was loaded
- **THEN** the following pages still contain no duplicate and skip no claim that matched at the start

### Requirement: Count of matching claims
The feed SHALL show the total number of claims matching the current search and filters, not the number of cards currently rendered.

#### Scenario: Count with more pages to load
- **WHEN** 303 claims match and 50 cards are rendered
- **THEN** the page says 303 match

#### Scenario: Count follows the filters
- **WHEN** a search or filter is applied
- **THEN** the count is the number of claims matching it

### Requirement: Search and filters
The feed SHALL offer a text search, a rating category filter and a publisher filter, which combine. The search SHALL split the text on whitespace and require every word to appear, ignoring case, in the claim text, rating text, rating explanation, publisher or original author. The filter choices SHALL be the categories and publishers present in the stored claims. Changing the search or a filter SHALL start the list again from its first page.

#### Scenario: Search words all must match
- **WHEN** the reader searches for two words
- **THEN** only claims where both words appear in the searched fields are listed

#### Scenario: Search ignores case
- **WHEN** the reader searches in a different letter case than the stored text
- **THEN** the same claims are listed

#### Scenario: Search characters are literal
- **WHEN** the reader searches for text containing % or _
- **THEN** those characters match only themselves

#### Scenario: Rating and publisher filters combine
- **WHEN** a category, a publisher and a search text are all set
- **THEN** only claims matching all three are listed

#### Scenario: Filter choices come from the data
- **WHEN** the feed is opened
- **THEN** the publisher choices are exactly the publishers present in the stored claims, and the category choices exactly the categories present

#### Scenario: Filter restarts the list
- **WHEN** the reader has loaded several pages and then changes a filter
- **THEN** the list shows the first page of the new result

#### Scenario: No match
- **WHEN** nothing matches the search and filters
- **THEN** the page says no fact-checks match and offers to clear the search and filters

### Requirement: Attribution is shown
The feed page SHALL show the attribution text recorded in the allowlist entry of the source of the claims it lists.

#### Scenario: Attribution visible
- **WHEN** the feed is opened
- **THEN** the attribution text of the Data Commons ClaimReview allowlist entry is on the page
