# The 29 World™

A classroom economy simulator for whole-class use, with individual student accounts. Students run their own money in a shared make-believe world: they earn from jobs, bank, budget, take loans, save with KiwiSaver and term deposits, trade shares, buy property, and more. Teachers manage the class, and parents can follow along.

**Live site:** https://fenrirak.github.io/The-29-World/

## What's inside

- **Student pages:** bank, budget, jobs, loans, KiwiSaver, term deposits, insurance, tax, shares market, marketplace, property, store, transport, events, quizzes, worksheets and reports.
- **Teacher and parent pages:** class management, bulk student setup, class export and parent view.
- **Installable and offline-friendly:** works as a web app (PWA) with an offline page.
- **Status page:** checks from the visitor's own device whether the website, sign-in, saving and security check can be reached, with steps to try and a list of addresses for school IT.

## How it's built

- Plain HTML, CSS and JavaScript. There is no build step and no package manager.
- Accounts and data use [Firebase](https://firebase.google.com/) (Authentication, Firestore and App Check), loaded from Google's CDN.
- Hosted on GitHub Pages.
- Fonts: the site uses Segoe UI and Trebuchet MS where the device has them. Devices without them get Selawik and Open Sans, served from `fonts/` with their license files.

## Running it locally

1. Clone the repo.
2. Serve the folder with any static server, for example `python3 -m http.server`.
3. Open `http://localhost:8000`.

Sign-in and saved data connect to the live Firebase project, so some features may not work on your own copy.

## Legal

© 2026 The 29 World™. All rights reserved. The source code and content are covered by the [License](LICENSE.txt). Use of the site is covered by the [Terms](terms.html), and personal data is handled as described in the [Privacy Policy](privacy.html).

Selawik and Open Sans are used under their own licenses (see `fonts/`).

## Contact

See the [About page](about.html).
