let stylesheet;

function loadStyles() {
  if (!stylesheet) {
    stylesheet = new Promise(resolve => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("teacher-mfa.css?v=add5c6a3", import.meta.url);
      link.onload = link.onerror = resolve;
      document.head.append(link);
    });
  }
  return stylesheet;
}

function mfaError(code, message) {
  return Object.assign(new Error(message), { code: `t29/${code}` });
}

export function authenticatorError(error) {
  switch (error?.code) {
    case "t29/mfa-cancelled": return "Verification was cancelled. You can try again when you're ready.";
    case "t29/mfa-session":
    case "auth/multi-factor-auth-required":
    case "auth/requires-recent-login":
    case "auth/user-token-expired": return "Please sign in again to continue.";
    case "t29/mfa-unavailable": return "This account needs an authenticator app. Contact support for help signing in.";
    case "auth/invalid-verification-code":
    case "auth/invalid-totp-code": return "That code didn't work. Check the selected authenticator and try the latest code.";
    case "auth/code-expired":
    case "auth/session-expired":
    case "auth/invalid-multi-factor-session": return "This request expired. Start again for a fresh code or setup key.";
    case "auth/operation-not-allowed":
    case "auth/unsupported-first-factor": return "Authenticator setup is currently unavailable. Contact support for help.";
    case "auth/maximum-second-factor-count-exceeded": return "This account has reached its authenticator limit.";
    case "auth/email-already-in-use": return "That email is already used by another account. Use your own sign-in address or contact support.";
    case "auth/invalid-email": return "Enter a valid email address you can open.";
    case "auth/network-request-failed": return "Check your internet connection and try again.";
    case "auth/too-many-requests": return "Too many attempts. Wait a few minutes and try again.";
    case "auth/invalid-credential":
    case "auth/wrong-password": return "Check your email and password and try again.";
    default: return "We couldn't complete that step. Please try again.";
  }
}

async function securityDialog(initialStep) {
  await loadStyles();
  return new Promise((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.className = "t29-security";
    dialog.setAttribute("aria-labelledby", "t29-security-title");
    dialog.setAttribute("aria-describedby", "t29-security-description");
    dialog.innerHTML = `<form class="t29-security-form">
      <header class="t29-security-header">
        <span class="t29-security-icon" aria-hidden="true">${typeof icon === "function" ? icon("shield", 25) : ""}</span>
        <div><p class="t29-security-step"></p><h2 id="t29-security-title"></h2></div>
      </header>
      <p id="t29-security-description" class="t29-security-description"></p>
      <div class="t29-security-fields"></div>
      <p class="t29-security-status" role="status"></p>
      <p class="t29-security-error" role="alert"></p>
      <footer class="t29-security-actions">
        <button type="button" class="btn secondary" data-cancel>Cancel</button>
        <button type="submit" class="btn gold" data-submit></button>
      </footer>
    </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form");
    const fields = form.querySelector(".t29-security-fields");
    const submit = form.querySelector("[data-submit]");
    const cancel = form.querySelector("[data-cancel]");
    const status = form.querySelector("[role=status]");
    const error = form.querySelector("[role=alert]");
    const previousFocus = document.activeElement;
    let busy = false;

    const close = (value, reason) => {
      dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      if (reason) reject(reason);
      else resolve(value);
    };
    const abort = () => { if (!busy) close(null, mfaError("mfa-cancelled", "Verification cancelled.")); };
    cancel.onclick = abort;
    dialog.addEventListener("cancel", event => { event.preventDefault(); abort(); });

    function show(step) {
      form.querySelector(".t29-security-step").textContent = step.label;
      form.querySelector("h2").textContent = step.title;
      form.querySelector(".t29-security-description").textContent = step.description;
      fields.innerHTML = step.fields || "";
      status.textContent = error.textContent = "";
      submit.textContent = step.submit || "";
      submit.hidden = !step.submit;
      cancel.textContent = step.cancel || "Cancel";
      cancel.onclick = step.dismiss ? () => { if (!busy) close(null); } : abort;
      const action = async (run, trigger = submit) => {
        if (busy) return;
        busy = true;
        error.textContent = "";
        const buttons = [...form.querySelectorAll("button")].filter(button => !button.disabled);
        buttons.forEach(button => { button.disabled = true; });
        const text = trigger.textContent;
        trigger.textContent = "Please wait…";
        form.setAttribute("aria-busy", "true");
        try { await run(); }
        catch (err) {
          error.textContent = err?.code === "t29/email-pending" ? err.message : authenticatorError(err);
          if (err?.code === "auth/invalid-verification-code" || err?.code === "auth/invalid-totp-code") {
            const code = fields.querySelector("[name=code]");
            code?.focus();
            code?.select();
          }
        } finally {
          busy = false;
          form.removeAttribute("aria-busy");
          buttons.forEach(button => { button.disabled = false; });
          if (trigger.textContent === "Please wait…") trigger.textContent = text;
        }
      };
      const controls = { fields, status, error, show, close, action, submit };
      form.onsubmit = event => {
        event.preventDefault();
        if (step.run) action(() => step.run(controls));
      };
      step.bind?.(controls);
      if (!dialog.open) dialog.showModal();
      (fields.querySelector("input:not([readonly]), select") || (step.submit ? submit : cancel)).focus();
    }
    try { show(initialStep); } catch (err) { close(null, err); }
  });
}

const supportLink = `<a href="index.html#contact" target="_blank" rel="noopener">Contact support</a>`;
const codeField = `<label for="t29-auth-code">Six-digit code</label>
  <input id="t29-auth-code" class="t29-security-code" name="code" inputmode="numeric" autocomplete="one-time-code"
    type="text" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required>`;

function readCode(fields) { return fields.querySelector("[name=code]").value; }

export function promptAuthenticator(factors, verify) {
  if (!factors.length) throw mfaError("mfa-unavailable", "No supported authenticator.");
  return securityDialog({
    label: "Teacher sign-in",
    title: "Verify with your authenticator",
    description: "Open your authenticator app and enter the current code for 29 World.",
    fields: `${factors.length > 1 ? `<label for="t29-factor">Authenticator</label>
      <select id="t29-factor"></select>` : ""}${codeField}
      <p class="t29-security-tip">Lost access to your authenticator? ${supportLink}.</p>`,
    submit: "Verify and continue",
    bind({ fields }) {
      const select = fields.querySelector("select");
      if (select) factors.forEach((factor, index) => {
        select.add(new Option(factor.displayName || `Authenticator ${index + 1}`, factor.uid));
      });
    },
    async run({ fields, close }) {
      const uid = fields.querySelector("select")?.value || factors[0].uid;
      close(await verify(uid, readCode(fields)));
    }
  });
}

function enrollmentStep(uid, label, complete) {
  async function generate({ show }) {
    const secret = await window.t29TeacherMfa.startEnrollment(uid);
    show({
      label,
      title: "Connect your authenticator",
      description: "In your authenticator app, add a time-based account named 29 World using this setup key.",
      fields: `<label for="t29-app-key">Setup key</label>
        <div class="t29-security-key">
          <input id="t29-app-key" type="text" spellcheck="false" autocomplete="off" readonly>
          <button type="button" class="btn secondary" data-copy>Copy</button>
        </div>
        <div class="t29-security-links">
          <a data-app>Open authenticator app</a>
          <button type="button" class="link-btn" data-refresh>Get a new key</button>
        </div>
        ${codeField}
        <p class="t29-security-tip">Keep this setup key private. You can add a backup authenticator from Teacher Home.</p>`,
      submit: "Confirm authenticator",
      bind({ fields, action, status }) {
        const key = fields.querySelector("#t29-app-key");
        key.value = secret.key;
        fields.querySelector("[data-app]").href = secret.uri;
        fields.querySelector("[data-copy]").onclick = async () => {
          try {
            await navigator.clipboard.writeText(secret.key);
            status.textContent = "Setup key copied.";
          } catch {
            key.focus();
            key.select();
            status.textContent = "Setup key selected. Copy it using your device's copy command.";
          }
        };
        const refresh = fields.querySelector("[data-refresh]");
        refresh.onclick = () => action(() => generate({ show }), refresh);
      },
      async run({ fields, close }) {
        const count = window.t29TeacherMfa.state(uid).factors.length;
        await secret.enroll(readCode(fields), count ? `Backup authenticator ${count}` : "Authenticator app");
        await complete(close);
      }
    });
  }
  return {
    label,
    title: "Set up an authenticator app",
    description: "An authenticator app generates a short code for each teacher sign-in. Keep access to the app so you can sign in again.",
    fields: `<p class="t29-security-tip">Use an app such as Microsoft Authenticator, Google Authenticator or the authenticator your school provides.</p>`,
    submit: "Get setup key",
    run: generate
  };
}

export function setUpAuthenticator({ uid, password, recoveryEmail, markReady }) {
  const auth = window.t29TeacherMfa;
  const state = auth.state(uid);
  const synthetic = /@t29\.local$/i.test(state.email);
  const proposedEmail = synthetic ? recoveryEmail : state.email;
  const enrollment = enrollmentStep(uid, "Step 2 of 2 · Authenticator", close => close(auth.state(uid).email));
  async function prepare(controls) {
    await markReady();
    controls.show(enrollment);
  }
  if (!synthetic && state.verified) {
    return securityDialog({ ...enrollment, async run(controls) { await markReady(); await enrollment.run(controls); } });
  }

  return securityDialog({
    label: "Step 1 of 2 · Verify your email",
    title: "Secure your teacher account",
    description: "Verify an email you can access. You'll use it with your password and an authenticator code for future sign-ins.",
    fields: `<label for="t29-security-email">Sign-in email</label>
      <input type="email" id="t29-security-email" name="email" autocomplete="email" maxlength="254" required>
      <p class="t29-security-tip">Your email stays private from students and classmates.</p>`,
    submit: "Send verification email",
    bind({ fields }) {
      const input = fields.querySelector("input");
      input.value = proposedEmail || "";
    },
    async run({ fields, show }) {
      const email = fields.querySelector("input").value.trim().toLowerCase();
      if (/@t29\.local$/.test(email)) throw { code: "auth/invalid-email" };
      await auth.sendVerification(uid, email);
      show({
        label: "Step 1 of 2 · Verify your email",
        title: "Check your inbox",
        description: `Open the link sent to ${email}, then return here to continue. Check your spam folder if it doesn't arrive.`,
        fields: `<div class="t29-security-links"><button type="button" class="link-btn" data-resend>Resend email</button></div>`,
        submit: "I've verified my email",
        bind({ fields, status, action }) {
          const resend = fields.querySelector("[data-resend]");
          resend.onclick = () => action(async () => {
            await auth.sendVerification(uid, email);
            status.textContent = "Verification email sent again.";
          }, resend);
        },
        async run(controls) {
          let verified;
          try { verified = await auth.confirmEmail(uid, email, password); }
          catch (error) {
            if (!["auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found", "auth/wrong-password"].includes(error.code)) throw error;
          }
          if (!verified) throw mfaError("email-pending", "The email isn't verified yet. Open the link first, then try again.");
          await prepare(controls);
        }
      });
    }
  });
}

export async function manageAuthenticators() {
  const auth = window.t29TeacherMfa;
  const user = window.firebase.auth().currentUser;
  if (!user || !await auth.hasSecondFactor(user.uid)) throw mfaError("mfa-session", "Sign in again.");
  await auth.refresh(user.uid);
  const { email, factors } = auth.state(user.uid);
  const action = await securityDialog({
    label: "Teacher account",
    title: "Account security",
    description: "Your password and authenticator protect access to your classes.",
    fields: `<dl class="t29-security-summary"><dt>Sign-in email</dt><dd data-email></dd>
      <dt>Authenticators</dt><dd data-count></dd></dl>
      <div class="t29-security-links"><button type="button" class="link-btn" data-change>Change sign-in email</button></div>
      <p class="t29-security-tip">A backup authenticator on a separate device helps you keep access if you lose your main device.</p>`,
    submit: factors.length < 5 ? "Add backup authenticator" : null,
    cancel: "Done",
    dismiss: true,
    bind({ fields, close }) {
      fields.querySelector("[data-email]").textContent = email;
      fields.querySelector("[data-count]").textContent = `${factors.length} connected · Required at sign-in`;
      fields.querySelector("[data-change]").onclick = () => close("email");
    },
    run({ close }) { close("backup"); }
  });
  if (!action) return "";

  const password = await window.t29Prompt("Enter your current password to confirm this security change.", "", {
    type: "password", placeholder: "Current password", confirmText: "Continue"
  });
  if (!password) return "";
  await user.reauthenticateWithCredential(window.firebase.auth.EmailAuthProvider.credential(email, password));
  if (action === "backup") {
    return securityDialog(enrollmentStep(user.uid, "Backup authenticator", close => close("Backup authenticator added.")));
  }
  return securityDialog({
    label: "Teacher account",
    title: "Change your sign-in email",
    description: "Verify the new email before you use it to sign in. Your password and authenticators stay the same.",
    fields: `<label for="t29-replacement-email">New sign-in email</label>
      <input type="email" id="t29-replacement-email" name="email" autocomplete="email" maxlength="254" required>`,
    submit: "Send verification email",
    async run({ fields, close }) {
      const nextEmail = fields.querySelector("input").value.trim().toLowerCase();
      if (nextEmail === email || /@t29\.local$/.test(nextEmail)) throw { code: "auth/invalid-email" };
      await auth.sendVerification(user.uid, nextEmail);
      close("Verification email sent. Open the link in your new inbox to finish the change.");
    }
  });
}
