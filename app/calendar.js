import { dayOffset, localDate } from './model.js?v=6';

export function createCalendar(onApply) {
  const dialog = document.querySelector('#calendar');
  const input = document.querySelector('#date-value');
  const time = document.querySelector('#time-value');
  const days = document.querySelector('#calendar-days');
  let month = new Date();
  function render() {
    month.setDate(1);
    document.querySelector('#month-label').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    days.replaceChildren();
    const start = new Date(month); start.setDate(1 - start.getDay());
    for (let index = 0; index < 42; index++) {
      const date = new Date(start); date.setDate(start.getDate() + index);
      const value = localDate(date);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = date.getDate(); button.dataset.date = value;
      button.classList.toggle('outside-month', date.getMonth() !== month.getMonth());
      button.setAttribute('aria-label', date.toLocaleDateString(undefined, { dateStyle: 'full' }));
      button.setAttribute('aria-pressed', String(value === input.value));
      if (value === localDate()) button.setAttribute('aria-current', 'date');
      button.onclick = () => { input.value = value; render(); days.querySelector(`[data-date="${value}"]`)?.focus(); };
      days.append(button);
    }
  }
  days.onkeydown = event => {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!offset || !event.target.dataset.date) return;
    event.preventDefault(); const date = new Date(`${event.target.dataset.date}T12:00`); date.setDate(date.getDate() + offset);
    month = new Date(date.getFullYear(), date.getMonth(), 1); render(); days.querySelector(`[data-date="${localDate(date)}"]`)?.focus();
  };
  input.onchange = () => { if (input.value) month = new Date(`${input.value}T12:00`); render(); };
  for (const [id, amount] of [['previous-month', -1], ['next-month', 1]]) document.getElementById(id).onclick = () => { month.setDate(1); month.setMonth(month.getMonth() + amount); render(); };
  dialog.querySelectorAll('[data-offset]').forEach(button => button.onclick = () => { input.value = dayOffset(Number(button.dataset.offset)); month = new Date(`${input.value}T12:00`); render(); });
  document.querySelector('#date-form').onsubmit = event => { event.preventDefault(); onApply(input.value + (time.value ? `T${time.value}` : '')); dialog.close(); };
  document.querySelector('#clear-date').onclick = () => { onApply(''); dialog.close(); };
  return due => { input.value = due.slice(0, 10); time.value = due.slice(11, 16); month = due ? new Date(`${input.value}T12:00`) : new Date(); render(); dialog.showModal(); };
}
