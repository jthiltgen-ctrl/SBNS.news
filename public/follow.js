document.querySelectorAll("[data-follow]").forEach((control) => {
  const button = control.querySelector("[data-copy-feed]");
  const field = control.querySelector("[data-feed-url]");
  const status = control.querySelector("[data-follow-status]");
  button.hidden = false;

  button.addEventListener("click", async () => {
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);

    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(field.value);
        copied = true;
      } catch {
        // Try the native selection-based copy fallback below.
      }
    }
    if (!copied) {
      try {
        copied = document.execCommand("copy");
      } catch {
        // The selected, visible address remains available for manual copying.
      }
    }
    status.textContent = copied
      ? "Feed address copied."
      : "The feed address is selected. Press Ctrl+C or Command+C to copy it.";
  });
});
