import CONFIG from '../config.js';

// Seguimiento de clics en social links
const socialLinks = document.querySelectorAll('.social-links a[aria-label]');
if (typeof window.gtag === 'function') {
  socialLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const label = link.getAttribute('aria-label') || link.href;
      window.gtag('event', 'social_click', {
        event_category: 'Social',
        event_label: label,
        value: 1
      });
    });
  });
}
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('commentForm');
  const nameInput = document.getElementById('nameInput');
  const textarea = document.getElementById('commentInput');
  const btn = form?.querySelector('button[type="submit"]');
  const mensaje = document.getElementById('commentStatus');
  if (form && nameInput && textarea && btn && mensaje) {
    const { formUrl, nameField, commentField } = CONFIG.comments;

    const showMessage = (text, isError = false) => {
      mensaje.textContent = text;
      mensaje.classList.toggle('comentario-mensaje--error', isError);
    };

    // Enviar con Ctrl+Enter
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nombre = nameInput.value.trim();
      const comentario = textarea.value.trim();
      if (!nombre || !comentario) {
        showMessage('Por favor, escribe tu nombre y un comentario antes de enviar.', true);
        return;
      }
      btn.disabled = true;
      showMessage('');
      const formData = new FormData();
      if (nameField === commentField) {
        // Mismo campo en el Google Form: se compone un solo valor (como el form de contacto)
        formData.append(
          commentField,
          `Comentario (Al Vacío)\nNombre: ${nombre}\n\nComentario:\n${comentario}`
        );
      } else {
        formData.append(nameField, nombre);
        formData.append(commentField, comentario);
      }
      // no-cors: Google Forms no manda headers CORS; la respuesta es opaca pero el envío se registra
      fetch(formUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: formData
      })
        .then(() => {
          form.reset();
          showMessage('¡Gracias por tu comentario!');
        })
        .catch(() => {
          showMessage('Ocurrió un error al enviar. Intenta de nuevo.', true);
        })
        .finally(() => {
          btn.disabled = false;
        });
    });
  }

  // Seguimiento de reproducciones del audio
  const audio = document.querySelector('audio');
  if (audio && typeof window.gtag === 'function') {
    audio.addEventListener('play', () => {
      window.gtag('event', 'audio_play', {
        event_category: 'Audio',
        event_label: 'Al Vacío',
        value: 1
      });
    });
  }
  // Carrusel Sponsors Mejorado
  let sponsorIndex = 0;
  const sponsorImgs = document.querySelectorAll('.sponsor-img');
  function showSponsorSlide(n) {
    sponsorImgs.forEach((img, i) => {
      img.classList.toggle('active', i === n);
    });
  }
  function nextSponsorSlide() {
    sponsorIndex = (sponsorIndex + 1) % sponsorImgs.length;
    showSponsorSlide(sponsorIndex);
  }
  // Inicializar
  if (sponsorImgs.length > 0) {
    showSponsorSlide(sponsorIndex);
  }
  // Auto-slide
  setInterval(nextSponsorSlide, 3000);
});
