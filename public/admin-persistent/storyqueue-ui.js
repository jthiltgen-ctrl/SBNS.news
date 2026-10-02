const target = document.querySelector("#storyqueue-email-status");

function row(label, value) {
  const p = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = label + ": ";
  p.append(strong, document.createTextNode(String(value ?? "—")));
  return p;
}

async function load() {
  if (!target) return;
  try {
    const response = await fetch("/api/admin/storyqueue/status", { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Story Queue status unavailable.");
    target.replaceChildren(
      row("Address", data.address),
      row("Email handler", data.email_worker_configured ? "Deployed" : "Not active"),
      row("Sender policy", data.sender_policy_configured ? `${data.allowed_sender_rule_count} rule(s)` : "Not configured"),
      row("Messages received", data.message_count),
      row("Story links received", data.url_count),
      row("Last received", data.last_received_at ? new Date(data.last_received_at).toLocaleString() : "None yet"),
      row("Attachments", "Ignored — not processed"),
      row("Secure source", "No — ordinary editorial email")
    );
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy Story Queue address";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(data.address);
      copy.textContent = "Address copied";
      setTimeout(() => { copy.textContent = "Copy Story Queue address"; }, 1500);
    });
    target.append(copy);
  } catch (error) {
    target.textContent = error.message;
  }
}

load();
