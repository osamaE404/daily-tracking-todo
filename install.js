let promptEvent;
const installButtons = [...document.querySelectorAll('[data-install]')];
const dialog = document.querySelector('#install-help');
addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  promptEvent = event;
});
installButtons.forEach(button => button.addEventListener('click', async () => {
  if (matchMedia('(display-mode: standalone)').matches) { location.href = '/app/'; return; }
  if (promptEvent) {
    const pending = promptEvent;
    promptEvent = null;
    await pending.prompt();
    const choice = await pending.userChoice;
    if (choice.outcome === 'accepted') button.textContent = 'Installed · open Todo';
  } else dialog?.showModal();
}));
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    const status = document.querySelector('[data-install-status]');
    if (status) status.textContent = 'Offline setup failed. Reload while connected to retry.';
  });
}
