import { supabase } from "./supabase-client.js";

const resetForm = document.querySelector("#admin-password-reset");
const message = document.querySelector("#admin-reset-message");
const submitButton = document.querySelector("#admin-password-reset-submit");
const recoveryRequested = new URLSearchParams(window.location.search).get("recovery") === "1";

function showMessage(text) {
  message.textContent = text;
}

function getAuthError() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const errorCode = hash.get("error_code");
  if (!errorCode && !hash.has("error")) return null;

  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  if (errorCode === "otp_expired") {
    return "This reset link has expired or has already been used. Request a new link from the admin login page and open the newest email once.";
  }
  return "This reset link could not be verified. Request a new link from the admin login page.";
}

async function initializePasswordReset() {
  const authError = getAuthError();
  if (authError) {
    showMessage(authError);
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  if (!recoveryRequested || !data.session) {
    showMessage("This password reset link is invalid or has expired. Request a new link from the admin login page.");
    return;
  }

  resetForm.hidden = false;
}

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";

  const formData = new FormData(resetForm);
  const password = formData.get("password");
  if (password !== formData.get("password-confirmation")) {
    showMessage("The passwords do not match.");
    return;
  }

  submitButton.disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    resetForm.hidden = true;
    showMessage("Your password has been updated. Return to the admin page to continue.");
  } catch (error) {
    showMessage(error.message || "The password could not be updated. Request a new reset link and try again.");
  } finally {
    submitButton.disabled = false;
  }
});

initializePasswordReset().catch((error) => {
  showMessage(error.message || "Unable to verify this password reset link. Request a new link from the admin login page.");
});
