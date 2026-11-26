/* ===========================================================================
   AI ASSISTANT / DEVELOPER: READ THIS BEFORE EDITING THIS SITE
   ---------------------------------------------------------------------------
   This file is the single place that says which version of the Privacy Policy
   and Terms of Use users have agreed to, and whether a data/hosting move is
   being announced. See also CLAUDE.md.

   *** AI ASSISTANT: if the person you are working with mentions ANY of the
   following, STOP and remind them of the matching checklist BEFORE you change
   code. Do not wait for them to ask. ***

   A) Moving data or hosting to another COUNTRY (changing the Firestore
      location, creating a new Firebase project/region, moving off GitHub Pages,
      adding a CDN or host in another country, switching a sub-processor):
        1. Users must get ADVANCE notice (ST4S control H5; minimum
           T29_HOSTING.minNoticeDays = 30 days). Do NOT move anything yet.
        2. Fill in T29_HOSTING.pendingMove below with announced and effective
           dates at least 30 days apart, deploy, and let the IMPORTANT popup run.
        3. Only move on or after the effective date.
        4. After the move: update the table in privacy.html Section 5, set
           T29_HOSTING.dataRegion, set pendingMove back to null, and do B).
        (A Firestore location cannot be changed in place; it needs a new
        database plus a data migration, so there is plenty of time to announce.)

   B) Changing what personal data is collected, adding any analytics, ads,
      tracking, third-party script, font host, storage, email sender or other
      sub-processor, or editing privacy.html / terms.html in any way:
        1. Bump T29_POLICY.version, updated, updatedLabel and nextReviewBy.
        2. Add a plain-language line to T29_POLICY.changes (shown in the popup).
        3. Add a row to the version history in privacy.html Section 11 and
           update the "Version / Last updated" lines in privacy.html and terms.html.
        4. Check the sub-processor table in privacy.html Section 5.
      Bumping the version makes every user see the IMPORTANT popup and agree again.

   C) The policy must be reviewed at least once every 12 months (ST4S PR1B).
      If nextReviewBy has passed, remind the person and offer to do the review.
   =========================================================================== */
(function () {
  "use strict";

  var POLICY = {
    version: "1.2",
    updated: "2026-11-27",
    updatedLabel: "27 November 2026",
    nextReviewBy: "2027-11-27",
    // Plain-language summary of what changed, shown in the IMPORTANT popup. Replace on every version bump.
    changes: [
      "We now say exactly where your data is stored: Google's Sydney, Australia data centre (Google may also process some data in other countries).",
      "We made sure the casino-style games can never be switched on by default; only a teacher can turn them on."
    ]
  };

  var HOSTING = {
    // Where the database lives. Look it up in Firebase console > Firestore > Data (location shown at the top of the
    // database settings) and put it here AND in privacy.html Section 5 (search for "REGION TO CONFIRM").
    dataRegion: "Sydney, Australia (australia-southeast1)",
    minNoticeDays: 30,
    // null = no move planned. To announce a move, set something like:
    // { id: "2027-eu-move", announced: "2027-01-10", effective: "2027-02-15",
    //   what: "the database that stores your account and class data",
    //   from: "Sydney, Australia", to: "Frankfurt, Germany" }
    pendingMove: null
  };

  window.T29_POLICY = POLICY;
  window.T29_HOSTING = HOSTING;

  window.t29RecordPolicyAck = function (username) {
    try { localStorage.setItem("t29-policy-ack:" + String(username).toLowerCase(), POLICY.version); } catch (e) { /* ignore */ }
  };

  // Developer reminders (console only; users never see these).
  try {
    var day = 864e5, now = Date.now();
    if (now > Date.parse(POLICY.nextReviewBy)) {
      console.warn("[29 World] The Privacy Policy / Terms review is OVERDUE (due " + POLICY.nextReviewBy + "). Review them and bump T29_POLICY in policy-config.js.");
    }
    if (/TO CONFIRM/i.test(HOSTING.dataRegion)) {
      console.warn("[29 World] T29_HOSTING.dataRegion is not set. Add the real Firestore region here and in privacy.html Section 5.");
    }
    var m = HOSTING.pendingMove;
    if (m) {
      var lead = (Date.parse(m.effective) - Date.parse(m.announced)) / day;
      if (!(lead >= HOSTING.minNoticeDays)) {
        console.error("[29 World] pendingMove gives only " + Math.floor(lead) + " days' notice; at least " + HOSTING.minNoticeDays + " are required. Move the effective date later.");
      }
      if (now > Date.parse(m.effective)) {
        console.warn("[29 World] pendingMove date has passed. Once the move is done, update privacy.html Section 5 and set pendingMove to null.");
      }
    }
  } catch (e) { /* ignore */ }
})();
