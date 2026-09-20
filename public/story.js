function selectAndFocus(field) {
  field.focus();
  field.select();
  field.setSelectionRange(0, field.value.length);
}

async function copyLink(field) {
  selectAndFocus(field);

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(field.value);
      return true;
    } catch {
      // Keep the visible permanent-link field selected for the manual fallback.
    }
  }

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

document.querySelectorAll("[data-share-controls]").forEach((controls) => {
  const nativeShareButton = controls.querySelector("[data-native-share]");
  const copyLinkButton = controls.querySelector("[data-copy-link]");
  const urlField = controls.querySelector("[data-share-url-field]");
  const status = controls.querySelector("[data-share-status]");
  const title = controls.dataset.shareTitle;
  const url = controls.dataset.shareUrl;

  if (typeof navigator.share === "function") {
    nativeShareButton.hidden = false;
    nativeShareButton.addEventListener("click", async () => {
      try {
        await navigator.share({ title, url });
      } catch (error) {
        if (error.name !== "AbortError") {
          status.textContent = "Sharing was unavailable. Use Copy Link instead.";
        }
      }
    });
  }

  copyLinkButton.addEventListener("click", async () => {
    const copied = await copyLink(urlField);
    status.textContent = copied
      ? "Link copied."
      : "The link is selected. Press Ctrl+C or Command+C to copy it.";
  });
});
