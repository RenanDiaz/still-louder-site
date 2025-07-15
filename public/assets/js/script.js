// Seguimiento de clics en social links
const socialLinks = document.querySelectorAll(".social-links a[aria-label]");
if (typeof window.gtag === "function") {
  socialLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      const label = link.getAttribute("aria-label") || link.href;
      window.gtag("event", "social_click", {
        event_category: "Social",
        event_label: label,
        value: 1,
      });
    });
  });
}
document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("comentario-form");
  const btn = document.getElementById("enviar-comentario");
  const textarea = document.getElementById("comentario");
  const mensaje = document.getElementById("comentario-mensaje");
  // Enviar con Ctrl+Enter
  textarea.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const comentario = textarea.value.trim();
    if (!comentario) {
      mensaje.style.display = "block";
      mensaje.style.color = "#f44336";
      mensaje.textContent = "Por favor, escribe un comentario antes de enviar.";
      return;
    }
    btn.disabled = true;
    mensaje.style.display = "none";
    const formUrl =
      "https://docs.google.com/forms/d/e/1FAIpQLSe8YfvuBNMBNjpclU3-0d0O_N5429TlJ4QWPpLwv_o0uh8n0A/formResponse";
    const formData = new FormData();
    formData.append("entry.1365306044", comentario);
    fetch(formUrl, {
      method: "POST",
      mode: "no-cors",
      body: formData,
    })
      .then(() => {
        textarea.value = "";
        mensaje.style.display = "block";
        mensaje.style.color = "#4caf50";
        mensaje.textContent = "¡Gracias por tu comentario!";
        btn.disabled = false;
      })
      .catch(() => {
        mensaje.style.display = "block";
        mensaje.style.color = "#f44336";
        mensaje.textContent = "Ocurrió un error al enviar. Intenta de nuevo.";
        btn.disabled = false;
      });
  });

  // Seguimiento de reproducciones del audio
  const audio = document.querySelector("audio");
  if (audio && typeof window.gtag === "function") {
    audio.addEventListener("play", function () {
      window.gtag("event", "audio_play", {
        event_category: "Audio",
        event_label: "Al Vacío",
        value: 1,
      });
    });
  }
});
