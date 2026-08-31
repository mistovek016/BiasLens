// popup.js - BiasLens Popup Controller

document.addEventListener('DOMContentLoaded', () => {
  const githubLink = document.getElementById('githubLink');

  // Ensure external GitHub link opens reliably in a new browser tab
  if (githubLink) {
    githubLink.addEventListener('click', (e) => {
      e.preventDefault();
      const url = githubLink.getAttribute('href');
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  }
});
