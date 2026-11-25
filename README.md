# 29 World™

A classroom economy simulator for whole-class use, with individual student accounts. Students run their own money in a shared make-believe world: they earn from jobs, bank, budget, take loans, save with KiwiSaver and term deposits, trade shares, buy property, and more. Teachers manage the class, and parents can follow along.

The homepage has sections for the class overview, setup, a sample payday and pricing. Access is free for everyone. Optional [donations](https://buymeacoffee.com/29world) help cover the database costs, especially for larger groups.

**Live site:** https://fenrirak.github.io/The-29-World/

## What's inside

- **Student pages:** bank, budget, jobs, loans, KiwiSaver, term deposits, insurance, shares market, marketplace, property, store, transport, events and reports.
- **Teacher and parent pages:** class management, tax settings, quiz creation, worksheets, bulk student setup, class export and parent view.
- **Installable and offline-friendly:** works as a web app (PWA) with an offline page.
- **Status page:** checks from the visitor's own device whether the website, sign-in, saving and supporting files can be reached, with steps to try and a list of addresses for school IT.

## How it's built

- Plain HTML, CSS and JavaScript. There is no build step and no package manager.
- Accounts and data use [Firebase](https://firebase.google.com/) (Authentication and Firestore), loaded from Google's CDN. Optional App Check is disabled in this copy.
- Hosted on GitHub Pages.
- Fonts: the site uses Segoe UI and Trebuchet MS where the device has them. Devices without them get Selawik and Open Sans, served from `fonts/` with their license files.

## Running it locally

1. Clone the repo.
2. Serve the folder with any static server, for example `python3 -m http.server`.
3. Open `http://localhost:8000`.

Sign-in and saved data connect to the live Firebase project, so some features may not work on your own copy.

## Real-world stocks

Teachers can enable **Stock Market → Real-world stocks and funds**, preview closing prices and add any number of available companies and funds in one selection. Every new class starts with this switched off. Turning it off pauses updates and keeps existing holdings. Trades use the numerical exchange price in classroom dollars. NZX listings show NZD and US listings show USD.

The five exchange-traded funds use issuer feeds from Smart (NZG, MDZ and AUS) and Vanguard (VTI and VOO). The nightly job uses each fund's closing market price and reported units outstanding. Students trade whole units. The teacher preview retains the full reported amount when Vanguard reports fractions. The annual fund fee is informational and is already reflected in fund performance.

The GitHub Actions workflow in `.github/workflows/real-stocks.yml` runs at midnight in `Pacific/Auckland`, including daylight saving. It updates Firestore even when the website is closed. Each quote carries its trading date and share-count date. Weekends keep the last close. If a feed is incomplete, the last verified quote stays in place and the workflow reports the affected ticker.

### One-time setup

1. Publish the changed site files and the workflow to the GitHub Pages repository's default branch. Deploy the included Firestore rules to project `world-e0c82` using the Firebase console or the project's normal rules deployment.
2. Confirm that your feed agreements cover storing closing prices, displaying them and their history to teachers and students, and using them to fill simulated orders and value portfolios. Check [Stock Market API's terms](https://www.stockmarketapi.ai/terms) for the permitted plan and save its key in GitHub Actions secrets as `STOCKMARKET_API_KEY`. The job requests company details and daily prices for four Nasdaq listings. NZX prices use the [NZXplorer MCP endpoint](https://nzxplorer.co.nz/developers), and NZX ordinary-share counts use issuer disclosures. When a filing omits an identifiable total, the last verified count and its original date remain visible.
3. Configure [Google Workload Identity Federation for GitHub Actions](https://github.com/google-github-actions/auth#setup) for this repository and its default branch. Grant the workflow identity impersonation of a dedicated service account, with Firestore data access (`roles/datastore.user`) on the project. Set repository Actions variables `STOCK_SYNC_IDENTITY_PROVIDER` to the full provider resource name and `STOCK_SYNC_SERVICE_ACCOUNT` to the account email.
4. Confirm **Refresh real-world stocks** appears under **Actions**. The first push of the workflow to `main` triggers a refresh. If the identity or key was configured afterward, select **Run workflow** to retry. Subsequent runs follow the schedule. The picker includes a dated starting quote for each listing and labels it “Saved quote” until an equally recent or newer verified close is available from Firestore.

Anthropic's Nasdaq ticker also identifies an unrelated company on another exchange. The importer checks the issuer and exchange. If the US provider cannot identify Anthropic, it checks the issuer's own quote page and keeps the date of the last verified close. Its initial US$88.91 quote is the 20 November 2026 close. Its initial 13,366,642,276 shares are the issuer's total common shares across classes after the underwriters exercised their option. [Investor quote](https://investor.anthropic.com/stock-quote/stock-quote/default.aspx) · [Final SEC prospectus](https://www.sec.gov/Archives/edgar/data/2130357/000162828026074944/anthropicpbc-424b4.htm) · [IPO closing announcement](https://www.anthropic.com/news/ipo-close)

The feed publishes end-of-day quotes. Follow the display, entitlement, reporting and retention terms of the products you license. [NZX data licensing](https://www.nzx.com/services/products-tools/data-connectivity/nzx-market-data/data-licensing) · [Nasdaq display policy](https://www.nasdaqtrader.com/content/AdministrationSupport/Policy/DISPLAYREQUIREMENTSPOLICY.pdf) · [NYSE market data policies](https://www.nyse.com/market-data/policies)

## Legal

© 2026 29 World™. All rights reserved. The source code and content are covered by the [License](LICENSE.txt). Use of the site is covered by the [Terms](terms.html), and personal data is handled as described in the [Privacy Policy](privacy.html).

Selawik and Open Sans are used under their own licenses (see `fonts/`).

## Contact

See the [About section](index.html#about).
