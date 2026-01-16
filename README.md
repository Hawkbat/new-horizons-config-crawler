# New Horizons Config Crawler

Automatically analyzes New Horizons mod configurations across the Outer Wilds modding ecosystem. This crawler pulls JSON config files from GitHub for all mods in the [Outer Wilds mod database](https://github.com/ow-mods/ow-mod-db), documents which features are used by which mods, and analyzes value ranges for each configuration property. Results are output as machine-readable JSON files and an interactive HTML interface for easy browsing.

## Requirements

- **Node.js**: v22.6.0 or newer (must support TypeScript type syntax stripping, ES modules, top-level await, and Promise-based fs API)
- **npm**: Included with Node.js
- **GitHub Token** (optional but recommended): For higher API rate limits when fetching from GitHub

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/new-horizons-config-crawler.git
   cd new-horizons-config-crawler
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root (see [Configuration](#configuration) section)

## Configuration

Create a `.env` file in the project root directory:

```env
# GitHub Personal Access Token (recommended for higher API rate limits)
# Generate at: https://github.com/settings/tokens
GITHUB_TOKEN=your_github_token_here

# Comma-separated list of specific mods to re-fetch from GitHub (others loaded from cache)
# Example: MOD_ALLOW_LIST=Alek.OWML,Cleric.NomaiTextPrinter,AlexDevs.OWAughJetpack
MOD_ALLOW_LIST=

# Set to 'true' to skip loading from local cache and always fetch fresh data from GitHub
SKIP_LOCAL_CACHE=false

# Set to 'true' to skip GitHub fetching and only analyze cached mod data
LOCAL_CACHE_ONLY=false
```

## Usage

Run the crawler with:

```bash
npm start
```

The crawler will:
1. Load any previously cached mod data from the local `mod-cache/` directory (unless `SKIP_LOCAL_CACHE=true`)
2. Fetch the latest mod database from GitHub (unless `LOCAL_CACHE_ONLY=true`)
3. Download New Horizons config files for each mod
4. Analyze all configuration files
5. Generate output reports

### Examples

Analyze all mods:
```bash
npm start
```

Update only specific mods from GitHub (others loaded from cache):
```bash
MOD_ALLOW_LIST="Alek.OWML,Cleric.NomaiTextPrinter" npm start
```

Skip local cache and always fetch from GitHub:
```bash
SKIP_LOCAL_CACHE=true npm start
```

Use cached data only (skip GitHub fetching):
```bash
LOCAL_CACHE_ONLY=true npm start
```

## Output

### JSON Analysis Files

Located in the `analysis/` directory, organized by configuration type:

- **addon-manifest/**: Analysis of addon manifest configurations
- **default-config/**: Analysis of mod settings configurations
- **manifest/**: Analysis of mod manifest files
- **planets/**: Analysis of planet configurations
- **systems/**: Analysis of star system configurations
- **title-screen/**: Analysis of title screen modification configurations

Each JSON file documents:
- Which mods use each configuration field
- The range of values used for numeric fields
- All distinct values used for each property
- Field types and usage patterns

### HTML Report

**File**: `analysis/index.html`

An interactive static HTML interface with embedded CSS and JavaScript that provides:
- Easy browsing of all analyzed configuration fields
- Visual representation of feature adoption across mods
- Value range analysis
- Searchable interface for exploring configurations

Open `analysis/index.html` in any web browser to view the complete analysis report.

## License

Copyright 2026 Hawkbar

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

Permission is granted to use, copy, modify, and distribute this software under the terms of the MIT License.
