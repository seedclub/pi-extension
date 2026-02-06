# Research Patterns

Templates and examples for different types of research artifacts.

## Research Types

### Company Profile

Basic information about a company.

```json
{
  "type": "company_profile",
  "title": "Acme Corp Company Profile",
  "content": {
    "description": "AI-powered supply chain optimization platform",
    "founded": "2024",
    "headquarters": "San Francisco, CA",
    "teamSize": 8,
    "website": "https://acme.com",
    "socialMedia": {
      "twitter": "@acmecorp",
      "linkedin": "company/acme-corp"
    },
    "product": {
      "name": "Acme Platform",
      "description": "End-to-end supply chain visibility and optimization",
      "pricing": "Enterprise pricing, custom quotes"
    }
  },
  "sourceUrls": [
    "https://acme.com/about",
    "https://crunchbase.com/organization/acme"
  ]
}
```

### Market Analysis

Market context and opportunity assessment.

```json
{
  "type": "market_analysis",
  "title": "Supply Chain SaaS Market Overview",
  "content": {
    "marketSize": {
      "tam": "$50B",
      "sam": "$15B",
      "som": "$500M"
    },
    "growth": "12% CAGR through 2028",
    "trends": [
      "AI/ML adoption accelerating",
      "Post-pandemic supply chain resilience focus",
      "Sustainability reporting requirements"
    ],
    "drivers": [
      "Global supply chain complexity",
      "Rising labor costs",
      "Regulatory compliance"
    ],
    "challenges": [
      "Long enterprise sales cycles",
      "Integration complexity",
      "Data quality issues"
    ]
  },
  "sourceUrls": [
    "https://example.com/market-report-2024",
    "https://gartner.com/supply-chain-trends"
  ]
}
```

### Founder Background

Information about a company's founder(s).

```json
{
  "type": "founder_background",
  "title": "Jane Smith - CEO Background",
  "content": {
    "name": "Jane Smith",
    "currentRole": "CEO & Co-founder at Acme Corp",
    "education": [
      {
        "school": "Stanford University",
        "degree": "MS Computer Science",
        "year": "2010"
      }
    ],
    "experience": [
      {
        "company": "BigCorp",
        "role": "VP Engineering",
        "years": "2018-2024",
        "highlights": [
          "Led team of 50 engineers",
          "Launched ML platform serving 10M users"
        ]
      },
      {
        "company": "StartupX (acquired)",
        "role": "Founder & CTO",
        "years": "2014-2018",
        "highlights": [
          "Built product from 0 to 1M users",
          "Acquired by BigCorp for $20M"
        ]
      }
    ],
    "notableAchievements": [
      "Forbes 30 Under 30 (2016)",
      "2 patents in ML optimization"
    ]
  },
  "sourceUrls": [
    "https://linkedin.com/in/janesmith",
    "https://forbes.com/30-under-30/2016"
  ]
}
```

### Competitive Analysis

Analysis of the competitive landscape.

```json
{
  "type": "competitive_analysis",
  "title": "Supply Chain SaaS Competitive Landscape",
  "content": {
    "directCompetitors": [
      {
        "name": "BigSAP",
        "description": "Enterprise supply chain suite",
        "strengths": ["Brand recognition", "Integration depth"],
        "weaknesses": ["High cost", "Complex implementation"],
        "funding": "$2B+ (public)",
        "marketShare": "25%"
      },
      {
        "name": "NimbleChain",
        "description": "SMB-focused supply chain tools",
        "strengths": ["Easy setup", "Low cost"],
        "weaknesses": ["Limited features", "Scale limits"],
        "funding": "$50M Series B",
        "marketShare": "5%"
      }
    ],
    "indirectCompetitors": [
      "General ERP systems",
      "Spreadsheet-based solutions",
      "Custom internal tools"
    ],
    "differentiators": [
      "AI-native architecture",
      "Enterprise-grade with SMB ease",
      "Real-time optimization"
    ]
  },
  "sourceUrls": [
    "https://g2.com/categories/supply-chain",
    "https://crunchbase.com/hub/supply-chain-companies"
  ]
}
```

### Financial Data

Funding and financial information.

```json
{
  "type": "financial_data",
  "title": "Acme Corp Funding History",
  "content": {
    "totalRaised": "$2.5M",
    "rounds": [
      {
        "name": "Pre-seed",
        "date": "2024-03",
        "amount": "$500K",
        "valuation": "$5M",
        "investors": ["Angel A", "Angel B"]
      },
      {
        "name": "Seed",
        "date": "2024-09",
        "amount": "$2M",
        "valuation": "$15M",
        "investors": ["VC Fund A", "VC Fund B"],
        "leadInvestor": "VC Fund A"
      }
    ],
    "metrics": {
      "arr": "Not disclosed",
      "customers": "10 pilots",
      "burnRate": "~$100K/month"
    },
    "nextRound": {
      "target": "Series A",
      "timeline": "Q2 2025",
      "targetAmount": "$10M"
    }
  },
  "sourceUrls": [
    "https://crunchbase.com/organization/acme/funding_rounds",
    "https://pitchbook.com/profiles/acme"
  ]
}
```

## Best Practices

### Source Quality

Prefer authoritative sources in this order:
1. Company's own website
2. Verified databases (Crunchbase, PitchBook, LinkedIn)
3. News from reputable outlets
4. Industry reports
5. Secondary sources with verification

### Information Freshness

Note when information was collected:
- Include `sourceUrls` for all facts
- Note if information may be outdated
- Update research when significant changes occur

### Structured vs Freeform

- Use structured JSON for quantifiable data
- Use freeform notes for qualitative observations
- Include both when helpful

### Confidence Annotation

When uncertain, note it:
```json
{
  "valuation": "$15M",
  "valuationConfidence": "medium",
  "valuationNote": "Based on typical seed round dilution, not directly confirmed"
}
```
