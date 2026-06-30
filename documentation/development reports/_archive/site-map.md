# Wildlife Watcher Website — Site Map & Page Structure

> **Status:** 🕰️ Historical snapshot — point-in-time design/roadmap; **not** kept current with the code.

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
| `/analyse-images` | `AnalyseImagesPage` | Image analysis — upload SD card media folders for EXIF extraction, iNaturalist lookup, image clustering. Includes Drive upload toggle |
| `/manifest` | `ManifestPage` | Prepare SD Card — download firmware + AI model package for field deployment |
| `/upload-model` | `UploadModelPage` | AI model upload (organisation managers only) — custom, pre-trained, or SenseCap Zoo models |

### Planned Renames

| Current Route | New Route | Status |
|---------------|-----------|--------|
| `/analyse-images` | `/upload-data` | Pending — will unify CamtrapDP import + media upload into single page |

## Navigation Structure

### Header Nav (authenticated)
```
Wildlife Watcher Web | Resources | My Data | Analyse Images | Prepare SD Card | [Upload Model*] | user@email | Logout
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
| `AnalyseImages` | `components/toolkit/AnalyseImages.tsx` | Analyse Images page |
| `PipelineStatusBox` | `components/toolkit/PipelineStatusBox.tsx` | Upload Data (progress tracking) |
| `INaturalistPanel` | `components/toolkit/INaturalistPanel.tsx` | Upload Data (species lookup) |
| `ImageClustering` | `components/toolkit/ImageClustering.tsx` | Analyse Images (duplicate detection) |

## Upload / Import Flows

### CamtrapDP Import (My Data page)

The My Data page includes a collapsible `CamtrapImport` panel:

```
User expands "📦 Import CamtrapDP Package" panel
        ↓
    Selects .zip file
        ↓
    POST /api/camtrapdp/import
    → Creates project, devices, deployments, media, observations
    → Shows result summary → Auto-switches to Map tab
```

### EXIF Analysis (Analyse Images page)

```
User drops/selects SD card media folder
        ↓
    Image files extracted from folder structure
        ↓
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
