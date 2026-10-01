// Assemble ordinary editorial email only on activation. This reduces trivial
// harvesting; it does not make the address secret or provide source protection.
const editorialContact = document.querySelector("#editorial-contact");

editorialContact?.addEventListener("click", (event) => {
  // Modified clicks retain the native link to the manual instructions.
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  const address = ["editor", ["shockedbutnotsurprised", "news"].join(".")].join("@");
  window.location.href = `mailto:${address}`;
  event.preventDefault();
});
