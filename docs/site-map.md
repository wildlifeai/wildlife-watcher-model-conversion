# Wildlife Watcher Website — Site Map & Page Structure

> **Last updated:** May 18, 2026

## Frontend Routes

### Public Pages (no authentication required)

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `HomePage` | Landing page with product overview and call-to-action |
| `/login` | `LoginPage` | Email/password login, GitHub OAuth, Google OAuth |
| `/reset-password` | `ResetPasswordPage` | Password reset flow (linked from login) |
| `/resources` | `ResourcesPage` | Comprehensive how-to guides: unboxing, setup, monitoring, AI models, AddaxAI analysis, troubleshooting |
| `/privacy` | `PrivacyPolicyPage` | Privacy Policy v2.0 — covers both mobile app and website |
| `/terms` | `TermsOfServicePage` | Terms of Service v1.0 — acceptable use, IP, liability, NZ law |
| `/support` | `SupportPage` | FAQ (12 items across 5 categories) and contact information |

### Authenticated Pages (require login)

| Route | Component | Description |
|-------|-----------|-------------|
| `/my-data` | `MyDataPage` | Data dashboard with 4 tabs: Projects, Deployments, Map (Leaflet), Reports (Recharts). Includes CSV and CamtrapDP export |
| `/upload-data` | `UploadDataPage` | Unified data upload — auto-detects ZIP (CamtrapDP import) vs media folders (EXIF analysis). Includes Drive upload toggle, iNaturalist panel, image clustering |
| `/manifest` | `ManifestPage` | Prepare SD Card — download firmware + AI model package for field deployment |
| `/upload-model` | `UploadModelPage` | AI model upload (organisation managers only) — custom, pre-trained, or SenseCap Zoo models |

### Redirects

| Old Route | Redirects To | Reason |
|-----------|-------------|--------|
| `/analyse-images` | `/upload-data` | Renamed in May 2026 — "Analyse Images" → "Upload Data" |

## Navigation Structure

### Header Nav (authenticated)
```
Wildlife Watcher Web | Resources | My Data | Upload Data | Prepare SD Card | [Upload Model*] | user@email | Logout
```
\* Upload Model only visible to organisation managers.

### Header Nav (unauthenticated)
```
Wildlife Watcher Web | Resources | Login
```

### Footer
```
© 2026 Wildlife.ai | Resources | Privacy Policy | Terms of Service | Support
```

## Data Components

| Component | Location | Used By |
|-----------|----------|---------|
| `DeploymentMap` | `components/data/DeploymentMap.tsx` | My Data (Map tab) |
| `ObservationReports` | `components/data/ObservationReports.tsx` | My Data (Reports tab) |
| `AnalyseImages` | `components/toolkit/AnalyseImages.tsx` | Upload Data page |
| `PipelineStatusBox` | `components/toolkit/PipelineStatusBox.tsx` | Upload Data (progress tracking) |
| `INaturalistPanel` | `components/toolkit/INaturalistPanel.tsx` | Upload Data (species lookup) |
| `ImageClustering` | `components/toolkit/ImageClustering.tsx` | Upload Data (duplicate detection) |

## Upload Data Flow

The Upload Data page (`/upload-data`) is a unified entry point for all data ingestion:

```
User drops/selects files
        │
        ├─ .zip file detected?
        │       ↓
        │   CamtrapDP Import Pipeline
        │   POST /api/camtrapdp/import
        │   → Creates project, devices, deployments, media, observations
        │   → Shows result summary → Link to My Data
        │
        └─ Image files detected?
                ↓
            EXIF Analysis Pipeline
            POST /api/exif/parse (batched, 10 images per request)
            → Extracts GPS, timestamps, deployment IDs, AI detections
            → Optional: upload to Google Drive
            → Shows results table with deployment matching
```

## Legal Pages Summary

| Page | Version | Effective Date | Key Coverage |
|------|---------|---------------|--------------|
| Privacy Policy | v2.0 | May 18, 2026 | Mobile app + website, file uploads, browser storage, Cloudflare analytics, GDPR |
| Terms of Service | v1.0 | May 18, 2026 | Accounts, acceptable use, IP ownership, AI models, liability, NZ law |
| Support | — | May 18, 2026 | 12 FAQs: pricing, orgs, offline mode, BLE, SD cards, data export |
