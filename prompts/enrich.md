# Seed Network Deal Enrichment

Add new information to an existing deal or company in Seed Network.

## Workflow

### Step 1: Find the Target

Use `search_deals` or `search_companies` to find the entity the user wants to enrich. If the user provided a name or slug, look it up with `get_deal` or `get_company`.

### Step 2: Review Current State

Display what information already exists and identify gaps:
- Missing founder details
- Outdated funding information
- No market analysis
- Missing social links

### Step 3: Research Updates

Use web search to gather new or updated information:
- Recent funding rounds
- Team changes
- Product launches
- Press coverage

### Step 4: Save Research

Use `save_research` to store new findings with source URLs.

### Step 5: Submit Enrichment

Use `add_enrichment` to submit changes for curator review:
- Include specific field updates with new values
- Set confidence levels (high, medium, low)
- Add source URLs for verification
- Include notes explaining the update

### Step 6: Summary

Report what was submitted:
- Fields updated
- PR number for tracking
- Any remaining gaps
