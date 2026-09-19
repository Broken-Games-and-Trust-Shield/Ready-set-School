const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const storageKey = 'ready-set-school-items';
const scheduleKey = 'ready-set-school-schedule-pdf';
const scheduleImageKey = 'ready-set-school-schedule-image';
const profileKey = 'ready-set-school-profile';
const accountsKey = 'ready-set-school-accounts';
const notificationKey = 'ready-set-school-notifications';
const supabaseUrl = 'https://vpbphspitqunjaxpmnbt.supabase.co';
const activeSessionKey = 'ready-set-school-active-session';

let items = [];
let account = null;
let profile = null;
let accountName = '';
let scheduleUrl = localStorage.getItem(scheduleKey);
let notifications = JSON.parse(localStorage.getItem(notificationKey) || '[]');function render() {
  resetExpiredChecks();
  const visible = items.filter((item) => item.days.includes(selectedDay));

  $('#checklist-items').innerHTML = visible.map((item) => `
    <article class="check-item ${item.doneDays.includes(selectedDay) ? 'done' : ''}">
      <input class="check-box" type="checkbox" ${item.doneDays.includes(selectedDay) ? 'checked' : ''} data-id="${item.id}" />
      <span class="item-name">${escapeHtml(item.name)}</span>
      <span class="item-days">${item.days.map(dayLabel).join(' · ')}</span>
      <button class="edit-item" data-edit="${item.id}">✎</button>
      <button class="delete-item" data-delete="${item.id}">×</button>
    </article>
  `).join('');

  $('#empty-state').classList.toggle('hidden', visible.length > 0);
  $('#progress-label').textContent = `${ready} of ${visible.length} ready`;
}function openItemDialog(item = null) {
  editingItemId = item?.id || null;
  setupDayPicker('#day-picker', item?.days || [1, 2, 3, 4, 5]);
  setupDayPicker('#reminder-day-picker', item?.reminderDays || item?.days || []);
  $('#item-dialog-title').textContent = item ? 'Edit task reminder' : 'Add to your list';
  $('#item-name').value = item?.name || '';
  $('#item-dialog').showModal();
}

$('#item-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#item-name').value.trim();
  const days = [...document.querySelectorAll('#day-picker input:checked')].map((input) => Number(input.value));
  const reminderDays = [...document.querySelectorAll('#reminder-day-picker input:checked')].map((input) => Number(input.value));

  if (!name || !days.length || ($('#reminder-enabled').checked && !reminderDays.length)) return;

  const reminderTime = $('#reminder-enabled').checked ? $('#reminder-time').value : '';

  const existingItem = items.find((item) => item.id === editingItemId);
  if (existingItem) {
    existingItem.name = name;
    existingItem.days = days;
    existingItem.reminderDays = reminderTime ? reminderDays : [];
    existingItem.reminderTime = reminderTime;
  } else {
    items.push({
      id: Date.now(),
      name,
      days,
      doneDays: [],
      reminderDays: reminderTime ? reminderDays : [],
      reminderTime
    });
  }

  void saveItems();
  $('#item-dialog').close();
  render();
});async function supabaseRequest(path, options = {}) {
  const headers = {
    apikey: supabaseAnonKey,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (!headers.Authorization) headers.Authorization = `Bearer ${cloudSession?.access_token || supabaseAnonKey}`;

  const response = await fetch(`${supabaseUrl}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.msg || error.message || error.error_description || 'Cloud request failed.');
  }

  const responseText = await response.text();
  return responseText ? JSON.parse(responseText) : null;
}

$('#account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = $('#account-name-input').value.trim();
  const email = $('#account-email').value.trim().toLowerCase();
  const password = $('#account-password').value;

  const endpoint = accountMode === 'login'
    ? '/auth/v1/token?grant_type=password'
    : `/auth/v1/signup${appRedirectUrl ? `?redirect_to=${encodeURIComponent(appRedirectUrl)}` : ''}`;

  const authResponse = await supabaseRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(accountMode === 'login'
      ? { email, password }
      : { email, password, data: { username, name: username } })
  });

  if (!authResponse?.access_token) {
    $('#account-error').textContent = 'Confirmation email sent. Check your inbox to finish creating your account.';
    return;
  }

  cloudSession = authResponse;
  localStorage.setItem(cloudSessionKey, JSON.stringify(cloudSession));
  // load profile / restore session logic continues here
});function startReminderCheck() {
  clearInterval(reminderTimer);
  if (!account || !('Notification' in window) || Notification.permission !== 'granted') return;

  const checkReminders = () => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dateKey = now.toLocaleDateString('en-CA');

    items.filter((item) => item.reminderDays.includes(now.getDay()) && item.reminderTime <= time && !item.doneDays.includes(now.getDay()))
      .forEach((item) => {
        const key = `${item.id}-${dateKey}-${item.reminderTime}`;
        if (notifications.some((notification) => notification.key === key)) return;

        notifications.unshift({
          key,
          title: 'Ready Set School',
          body: `Remember: ${item.name}`,
          time: now.toLocaleString(),
          read: false
        });

        saveNotifications();
        renderNotifications();
        new Notification('Ready Set School', { body: `Remember: ${item.name}` });
      });
  };

  checkReminders();
  reminderTimer = setInterval(checkReminders, 60000);
}$('#schedule-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file || file.type !== 'application/pdf') return;

  scheduleUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  localStorage.setItem(scheduleKey, scheduleUrl);
  localStorage.removeItem(scheduleImageKey);
  void showSchedule(scheduleUrl);
});

async function showSchedule(source) {
  const image = localStorage.getItem(scheduleImageKey);
  if (image) {
    $('#schedule-image').src = image;
  } else {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    const pdf = await pdfjs.getDocument(source).promise;
    const page = await pdf.getPage(1);
    const canvas = document.createElement('canvas');
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: 1.5 }) }).promise;
    const renderedImage = canvas.toDataURL('image/png');
    localStorage.setItem(scheduleImageKey, renderedImage);
    $('#schedule-image').src = renderedImage;
  }
}
