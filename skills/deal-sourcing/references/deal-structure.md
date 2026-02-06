# Deal Data Structure

Complete field documentation for Seed Network deals.

## Required Fields

These fields must be provided when creating a deal:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | string | Company name | "Acme Corp" |
| `website` | string | Company website URL | "https://acme.com" |
| `summary` | string | One-line description (under 200 chars) | "AI-powered supply chain optimization for enterprises" |

## Recommended Fields

Include these when available:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `stage` | string | Funding stage | "pre-seed", "seed", "series-a" |
| `sector` | string | Industry sector | "enterprise-saas", "fintech", "healthtech" |
| `founders` | array | Founder information | See below |
| `fundingHistory` | array | Previous funding rounds | See below |

### Founder Object

```json
{
  "name": "Jane Smith",
  "role": "CEO",
  "linkedin": "https://linkedin.com/in/janesmith",
  "background": "Previously VP Engineering at BigCorp"
}
```

### Funding Round Object

```json
{
  "round": "pre-seed",
  "amount": 500000,
  "date": "2024-06-01",
  "investors": ["Angel Investor A", "VC Fund B"]
}
```

## Optional Fields

Additional information that enriches the deal:

| Field | Type | Description |
|-------|------|-------------|
| `valuation` | number | Last known valuation in USD |
| `teamSize` | number | Current team size |
| `founded` | string | Year founded |
| `headquarters` | string | Location |
| `marketSize` | string | Total addressable market |
| `competitors` | array | List of competitors |
| `notes` | string | Additional notes or context |

## Status Values

Deals progress through these statuses:

| Status | Description |
|--------|-------------|
| `draft` | Initial creation, not yet submitted |
| `submitted` | Submitted for review |
| `reviewed` | Curator has reviewed |
| `published` | Visible to all members |
| `archived` | No longer active |

## Sector Taxonomy

Use consistent sector values:

- `enterprise-saas` - B2B software
- `developer-tools` - Tools for developers
- `fintech` - Financial technology
- `healthtech` - Healthcare technology
- `consumer` - Consumer products/apps
- `marketplace` - Two-sided marketplaces
- `hardware` - Physical products
- `ai-ml` - AI/ML focused
- `crypto-web3` - Blockchain/Web3
- `climate` - Climate technology

## Stage Taxonomy

Use consistent stage values:

- `idea` - Pre-product
- `pre-seed` - Building MVP
- `seed` - Finding product-market fit
- `series-a` - Scaling
- `series-b` - Expanding
- `growth` - Later stage
