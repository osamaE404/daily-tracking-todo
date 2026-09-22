export function reminderLabel(minutes, allDay = false) {
  if (minutes === 0) return 'At due time';
  if (allDay && minutes >= 0 && minutes < 1440) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
    return `At ${hour}:${String(minutes % 60).padStart(2, '0')} on the date`;
  }
  const before = minutes < 0, value = Math.abs(minutes);
  const amount = value % 1440 === 0 ? value / 1440 : value % 60 === 0 ? value / 60 : value;
  const unit = value % 1440 === 0 ? 'day' : value % 60 === 0 ? 'hour' : 'minute';
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ${before ? 'before' : 'after'}`;
}

export async function enableNotifications() {
  if (!('Notification' in window)) return 'This browser does not support notifications.';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  return permission === 'granted' ? 'Browser alerts enabled while Todo is open.' : 'Browser notifications are blocked.';
}

export function startReminderChecks(tasks) {
  async function check() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    for (const task of Object.values(tasks()).filter(task => !task.done && !task.deleted && task.due)) {
      const due = new Date(task.due.length === 10 ? `${task.due}T00:00` : task.due).getTime();
      for (const minutes of task.reminders || []) {
        const target = due + minutes * 60_000, key = `todo-reminder:${task.id}:${task.due}:${minutes}`;
        if (target > now || now - target > 90_000 || localStorage.getItem(key)) continue;
        localStorage.setItem(key, 'shown');
        const registration = await navigator.serviceWorker?.ready.catch(() => null);
        if (registration) await registration.showNotification(task.title, { body: 'Todo reminder', tag: key });
        else new Notification(task.title, { body: 'Todo reminder', tag: key });
      }
    }
  }
  check(); return setInterval(check, 30_000);
}
