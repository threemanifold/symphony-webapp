const emptyMessage = "Enter a message to send.";
const loadingMessage = "Sending...";
const genericError = "Unable to send message. Try again.";

export function formatResponse(response) {
  const text = typeof response === "string" ? response.trim() : "";
  return text || "No response returned.";
}

export async function postChatMessage(message, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch implementation is required");
  }

  const response = await fetchImpl("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed with ${response.status}`);
  }

  const payload = await response.json();
  return formatResponse(payload.response);
}

export function createChatController({ input, form, sendButton, output, fetchImpl }) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = input.value.trim();
    if (!message) {
      output.textContent = emptyMessage;
      return;
    }

    sendButton.disabled = true;
    output.textContent = loadingMessage;

    try {
      output.textContent = await postChatMessage(message, fetchImpl);
    } catch {
      output.textContent = genericError;
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  });
}

const form =
  typeof document === "undefined" ? null : document.querySelector("[data-chat-form]");

if (form) {
  createChatController({
    input: document.querySelector("[data-chat-input]"),
    form,
    sendButton: document.querySelector("[data-chat-submit]"),
    output: document.querySelector("[data-chat-output]"),
  });
}
