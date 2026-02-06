---
name: Deal Sourcing
description: |
  This skill provides guidance for deal sourcing and research workflows in Seed Network.
  Use this skill when the user wants to source a deal, research a company for seed network,
  create a deal, add a deal to seed network, save research, store research,
  enrich a deal, or add information to a deal.
---

# Deal Sourcing for Seed Network

Guide users through effective deal sourcing, research collection, and deal enrichment workflows for Seed Network's collaborative investment corpus.

## Core Concepts

### Deals vs Research

Understand when to save research versus create a deal:

**Research artifacts** are raw information collected during sourcing:
- Company profiles and background information
- Market analysis and competitive landscape
- Founder backgrounds and track records
- News articles, press releases, and announcements
- Any partial or unstructured information

**Deals** are structured investment opportunities ready for review:
- Complete company information with verified data
- Clear investment thesis
- Structured fields for comparison across deals

**Rule of thumb**: Save research first, create deals when you have enough information to fill required fields confidently.

### Attribution Model

All contributions in Seed Network are attributed:
- Deals show who created them and when
- Research artifacts track their creator
- Enrichments preserve a history of who added what
- Quality contributions are valued over quantity

## Deal Creation Workflow

When creating a deal, follow this structured approach:

### 1. Gather Initial Information
- Company name and website (required)
- One-line summary of what they do (required)
- Funding stage (pre-seed, seed, Series A, etc.)
- Industry sector

### 2. Research Founders
- Founder names and roles
- LinkedIn profiles for verification
- Previous experience and track record
- Save founder research before creating the deal

### 3. Collect Market Context
- Market size and growth
- Key competitors
- Unique positioning
- Save market research artifacts

### 4. Create the Deal
Use the `create_deal` tool with structured data:
- Include all required fields
- Add recommended fields when available
- Link supporting research after creation

### 5. Link Research
Use `link_research` to associate research artifacts with the deal for provenance.

## Enrichment Workflow

When enriching an existing deal:

### 1. Review Current State
Use `get_deal` to see what information already exists.

### 2. Identify Gaps
Look for missing or outdated information:
- Funding history updates
- Valuation changes
- Team changes
- Product updates

### 3. Gather Supporting Evidence
- Find authoritative sources
- Save research artifacts with source URLs
- Note confidence level (high, medium, low)

### 4. Submit Enrichment
Use `add_enrichment` to submit changes:
- Enrichments create a GitHub PR for curator review
- Include source URLs for verification
- Add notes explaining the update

### 5. Wait for Approval
Enrichments require curator approval before being applied to the deal.

## Best Practices

### Source URL Discipline
- Always include source URLs for provenance
- Prefer authoritative sources (company website, Crunchbase, LinkedIn)
- Note when information is inferred vs directly sourced

### Research Type Taxonomy
Use consistent types when saving research:
- `company_profile` - Basic company information
- `market_analysis` - Market size, trends, competitors
- `founder_background` - Founder experience and track record
- `competitive_analysis` - Competitive landscape
- `financial_data` - Funding history, valuation, revenue

### Confidence Levels
Rate your confidence in information:
- **High**: Directly from authoritative source, recently verified
- **Medium**: From reliable source, may need verification
- **Low**: Inferred or from secondary source

## Reference Documentation

For detailed field specifications, see:
- `references/deal-structure.md` - Complete deal field documentation
- `references/research-patterns.md` - Research type examples and templates
