# Browser testing reference

Saved on 11 November 2026 for future chats working on The 29 World.

## Site and test accounts

Open [The 29 World](https://fenrirak.github.io/The-29-World/index.html) in a real browser. The dedicated test class code is `2SN8U`.

| Role | Username | Password |
| --- | --- | --- |
| Teacher | `codex.audit.261110` | `T29-Audit-83Kq-261110` |
| Student | `codex.auditone` | `NArOQc` |
| Second student | `codex.audittwo` | `oTjVte` |

These disposable accounts were created during the original audit. Check that login still works before relying on them. These credentials were last recorded during that audit and were not reverified when this file was written.

## User authorization

The user authorized changing settings and sample data in test class `2SN8U`, including through the teacher account. The user also explicitly approved submitting the original disposable teacher and student signups with the site's Terms of Use and Privacy Policy agreement.

The original co-teacher invite was used. Generate a fresh invite from the teacher account if another co-teacher account is needed.

The user disabled module locks caused by low lifestyle ratings during the original audit. Check current class settings if a module is inaccessible.

## Testing procedure

1. Use separate browser profiles for simultaneous teacher and student sessions, or sign out before switching accounts. Use both students for flows involving classmates.
2. Walk through the site's pages and available actions as both roles. Exercise normal use and edge cases through the visible interface.
3. Check calculations using small examples that can be verified independently. Record starting balances and relevant settings before financial actions, then compare balances, history and reports afterward.
4. Reload after saving to verify persistence. For cross-device behavior, sign into the same account in two separate browser profiles and check whether changes appear in both.
5. Check layouts at desktop and mobile viewport sizes, including forms, dialogs, tables and long text.
6. For each reproducible issue, record the page, role, steps, expected result and actual result. Record anything that could not be verified and the reason.
7. Confirm whether the browser is testing the deployed GitHub Pages version or a local preview. If the versions differ, identify which version produced each finding.

## Handling this reference

This file contains disposable test-account passwords. Keep it as a local testing reference unless the user explicitly requests publishing it.

Future chats can be directed to read `BROWSER-TESTING.md` in the project folder before browser testing.
