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

## Teacher multi-factor authentication

Teacher and co-teacher accounts currently use username and password, with optional email recovery. Accounts already switched to sign-in email still use their email and password. MFA enrollment and enforcement are paused. Student and pending student accounts continue to use their existing username and password. Family view uses a read-only sharing link and does not have a separate account type.

For a future MFA rollout, switch `T29_REQUIRE_TEACHER_MFA` in `data-core.js` and `teacherMfaRequired()` in `firestore.rules` on together, restore the MFA signup copy and required email field, and update the policy. Before that release, check that the existing Firebase project uses Authentication with Identity Platform, has [TOTP enabled](https://firebase.google.com/docs/auth/web/totp-mfa), and can send and complete email verification, email changes and password resets with the project's configured email handlers. Keep Email/Password enabled and retain Email Link sign-in while legacy username-based recovery is needed. Check Identity Platform billing before upgrading the project. Verify a new signup, a legacy teacher migration, a second-factor sign-in and password reset, and a student sign-in in a test configuration before releasing. Once enabled, existing teacher sessions without TOTP will be asked to sign in and complete setup.

For a lost authenticator, verify the teacher through a trusted school contact or other independently verified channel before any administrative action. For a verified recovery, use the Firebase Admin account tools to remove only the unavailable factor if a backup remains, or clear the unavailable factors and revoke refresh tokens if a full re-enrolment is needed. The teacher signs in and enrols again before opening classes. Vendor staff and administrators use separate Google Cloud and GitHub identities. Their MFA enforcement and evidence are managed in those platforms for ST4S A5.

## Real-world stocks

Teachers can enable **Stock Market → Real-world stocks and funds**, preview closing prices and add any number of available companies and funds in one selection. Every new class starts with this switched off. Turning it off pauses updates and keeps existing holdings. Trades use the numerical exchange price in classroom dollars. NZX listings show NZD and US listings show USD.

The five exchange-traded funds use issuer feeds from Smart (NZG, MDZ and AUS) and Vanguard (VTI and VOO). The refresh job uses each fund's closing market price and reported units outstanding. Students trade whole units. The teacher preview retains the full reported amount when Vanguard reports fractions. The annual fund fee is informational and is already reflected in fund performance.

The stock workflow runs at 12:13 am in `Pacific/Auckland`, including daylight saving. It updates Firestore even when the website is closed. Opening any signed-in page in a class with real stocks enabled queues a shared refresh if one is due. GitHub Actions checks for requests every 30 minutes and publishes verified prices to all active classes with real stocks enabled. Another check can be requested after the NZ or US close is due. Each quote carries its trading date and share-count date. Weekends keep the last close. If a feed is incomplete, the last verified quote stays in place and the workflow reports the affected ticker.

### One-time setup

1. Publish the changed site files and the workflow to the GitHub Pages repository's default branch. Deploy the included Firestore rules to project `world-e0c82` using the Firebase console or the project's normal rules deployment.
2. Confirm that your feed agreements cover storing closing prices, displaying them and their history to teachers and students, and using them to fill simulated orders and value portfolios. Check [Stock Market API's terms](https://www.stockmarketapi.ai/terms) for the permitted plan and save its key in GitHub Actions secrets as `STOCKMARKET_API_KEY`. The job requests company details and daily prices for four Nasdaq listings. NZX prices use the [NZXplorer MCP endpoint](https://nzxplorer.co.nz/developers), and NZX ordinary-share counts use issuer disclosures. When a filing omits an identifiable total, the last verified count and its original date remain visible.
3. Configure [Google Workload Identity Federation for GitHub Actions](https://github.com/google-github-actions/auth#setup) for this repository and its default branch. Grant the workflow identity impersonation of a dedicated service account, with Firestore data access (`roles/datastore.user`) on the project. Set repository Actions variables `STOCK_SYNC_IDENTITY_PROVIDER` to the full provider resource name and `STOCK_SYNC_SERVICE_ACCOUNT` to the account email.
4. Confirm **Refresh real-world stocks** appears under **Actions**. The first push of the workflow to `main` triggers a refresh. If the identity or key was configured afterward, select **Run workflow** to retry. Subsequent runs follow the schedule. The picker includes a dated starting quote for each listing and labels it “Saved quote” until an equally recent or newer verified close is available from Firestore.

Anthropic's Nasdaq ticker also identifies an unrelated company on another exchange. The importer checks the issuer and exchange. If the US provider cannot identify Anthropic, it checks the issuer's own quote page and keeps the date of the last verified close. Its initial US$88.91 quote is the 20 November 2026 close. Its initial 13,366,642,276 shares are the issuer's total common shares across classes after the underwriters exercised their option. [Investor quote](https://investor.anthropic.com/stock-quote/stock-quote/default.aspx) · [Final SEC prospectus](https://www.sec.gov/Archives/edgar/data/2130357/000162828026074944/anthropicpbc-424b4.htm) · [IPO closing announcement](https://www.anthropic.com/news/ipo-close)

The feed publishes end-of-day quotes. Follow the display, entitlement, reporting and retention terms of the products you license. [NZX data licensing](https://www.nzx.com/services/products-tools/data-connectivity/nzx-market-data/data-licensing) · [Nasdaq display policy](https://www.nasdaqtrader.com/content/AdministrationSupport/Policy/DISPLAYREQUIREMENTSPOLICY.pdf) · [NYSE market data policies](https://www.nyse.com/market-data/policies)

## Before you change data location, hosting or policies

```
AI ASSISTANT / DEVELOPER REMINDERS (read before editing; see policy-config.js for the full checklists)

1. Moving data or hosting to another COUNTRY (Firestore location, new Firebase project/region, leaving GitHub Pages, a new CDN/host):
   users must be warned at least 30 days BEFORE the move. Do not move anything yet. Set T29_HOSTING.pendingMove in policy-config.js
   (announced + effective dates 30+ days apart) so the IMPORTANT popup runs, then move on/after the effective date, then update
   privacy.html Section 5, set dataRegion, and clear pendingMove.
2. Any change to privacy.html or terms.html, to what personal data is collected, or to any third-party service/script/font/host/email sender:
   bump T29_POLICY (version, updated, updatedLabel, nextReviewBy, changes) in policy-config.js, add a row to the version history in
   privacy.html Section 11, update the Version/Last-updated lines in privacy.html and terms.html, and re-check the Section 5 sub-processor table.
3. The policy must be reviewed at least every 12 months. If T29_POLICY.nextReviewBy has passed, remind the developer.
4. Before deploying, search the site for "REGION TO CONFIRM" and replace it with the real Firestore region.

If the person you are working with mentions any of the above, REMIND THEM before making code changes.
```

The Privacy Policy and Terms of Use carry a version (`policy-config.js`). When the version changes, every signed-in user sees an IMPORTANT popup (`policy-notice.js`) and must agree again. Test it on localhost with `?t29preview=policy` or `?t29preview=hosting`.

## Legal

© 2026 29 World™. All rights reserved. The source code and content are covered by the [License](LICENSE.txt). Use of the site is covered by the [Terms](terms.html), and personal data is handled as described in the [Privacy Policy](privacy.html).

Selawik and Open Sans are used under their own licenses (see `fonts/`).

## Contact

See the [About section](index.html#about).
