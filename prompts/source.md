# Seed Network Deal Sourcing

Guide the user through a structured deal sourcing workflow. This command helps research a company thoroughly and create a high-quality deal submission.

## Workflow

### Step 1: Identify the Target Company

If the user provided a company name or website, use that. Otherwise, ask:
- What company would you like to research?
- Do you have a website URL?

### Step 2: Check for Duplicates

Before proceeding, search for existing deals to avoid duplicates:
- Use `search_deals` with the company name
- If a match exists, inform the user and offer to enrich instead

### Step 3: Research Phase

Conduct thorough research using web search and fetch. Gather information on:

**Company Basics** (required):
- Official company name
- Website URL
- One-line summary of what they do

**Team Information**:
- Founder names and roles
- LinkedIn profiles
- Previous experience and track record

**Business Context**:
- Funding stage and history
- Industry sector
- Product/service details

**Market Context**:
- Market size and trends
- Key competitors
- Unique positioning

### Step 4: Save Research Artifacts

As you gather information, save research artifacts:
- Use `save_research` for each distinct piece of research
- Include source URLs for provenance
- Use appropriate types: `company_profile`, `founder_background`, `market_analysis`

### Step 5: Create the Deal

When you have sufficient information:
- Use `create_deal` with structured data
- Fill all required fields (name, website, summary)
- Include recommended fields when available (stage, sector, founders)

### Step 6: Link Research

After creating the deal:
- Use `link_research` to connect saved research artifacts
- This provides provenance and context for reviewers

### Step 7: Summary

Provide the user with:
- Confirmation of deal creation
- Summary of what was captured
- Any gaps that could be filled with future enrichments

## Quality Standards

A good deal submission includes:
- Accurate company name and working website
- Clear, specific summary (not generic)
- At least one founder with LinkedIn
- Funding stage identified
- Source URLs for key facts
