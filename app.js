const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const storageKey = 'ready-set-school-items';
const scheduleKey = 'ready-set-school-schedule-pdf';
const scheduleImageKey = 'ready-set-school-schedule-image';
const scheduleTextKey = 'ready-set-school-schedule-text';
const profileKey = 'ready-set-school-profile';
const accountsKey = 'ready-set-school-accounts';
const notificationKey = 'ready-set-school-notifications';
const assistantPermissionKey = 'ready-set-school-assistant-schedule-permission';
const supabaseUrl = 'https://vpbphspitqunjaxpmnbt.supabase.co';
const supabaseAnonKey = 'sb_publishable_5nBMd8_pZsePqJEyvjO2Bg_nip6gLAs';
const cloudSessionKey = 'ready-set-school-cloud-session';
const rememberSessionKey = 'ready-set-school-remember-session';
const activeSessionKey = 'ready-set-school-active-session';
const vapidPublicKey = 'BFTef9m9TYbsDVPXFHf6DY6GdC7b5JcQHONngqbIJi7e_Oq6bdjgluOCN2Vqki8kb3ffNhJCZPdRRs6Bwqkeka8';
const appRedirectUrl = /^https?:$/.test(window.location.protocol) ? `${window.location.origin}${window.location.pathname}` : null;
const today = new Date().getDay();
let selectedDay = today === 0 || today === 6 ? 1 : today;
const defaultItems = [
  { id: 1, name: 'Backpack', days: [1, 2, 3, 4, 5], doneDays: [], reminderTime: '' },
  { id: 2, name: 'Water bottle', days: [1, 2, 3, 4, 5], doneDays: [], reminderTime: '' },
  { id: 3, name: 'Lunch box', days: [1, 2, 3, 4, 5], doneDays: [], reminderTime: '' },
  { id: 4, name: 'Math homework', days: [1, 3], doneDays: [], reminderTime: '' }
];
const getWeekKey = (date = new Date()) => {
  const monday = new Date(date);
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
};
const currentWeekKey = getWeekKey();
const normalizeItems = (list) => (Array.isArray(list) ? list : []).map((item) => ({ ...item, doneDays: Array.isArray(item.doneDays) ? item.doneDays : [], doneWeek: item.doneWeek || null, reminderDays: Array.isArray(item.reminderDays) ? item.reminderDays : (item.reminderTime ? item.days : []), reminderTime: item.reminderTime || '' }));
const savedItems = JSON.parse(localStorage.getItem(storageKey) || 'null');
const legacyProfile = JSON.parse(localStorage.getItem(profileKey) || 'null');
let accounts = JSON.parse(localStorage.getItem(accountsKey) || 'null') || {};
if (legacyProfile && !Object.keys(accounts).length) {
  const legacyKey = legacyProfile.email.trim().toLowerCase();
  accounts[legacyKey] = { ...legacyProfile, username: legacyProfile.username || legacyProfile.name, items: normalizeItems(savedItems || defaultItems) };
  localStorage.setItem(accountsKey, JSON.stringify(accounts));
}
let items = [];
const $ = (selector) => document.querySelector(selector);
let account = null;
let accountName = '';
let activeAccountKey = null;
let scheduleUrl = localStorage.getItem(scheduleKey);
let scheduleText = localStorage.getItem(scheduleTextKey) || '';
let profile = null;
let reminderTimer;
let deferredInstallPrompt = null;
let notifications = JSON.parse(localStorage.getItem(notificationKey) || '[]');
let assistantCanScanSchedule = localStorage.getItem(assistantPermissionKey) === 'true';
let cloudSession = JSON.parse(localStorage.getItem(cloudSessionKey) || 'null');
let rememberedSession = JSON.parse(localStorage.getItem(rememberSessionKey) || 'null');
let activeSessionId = localStorage.getItem(activeSessionKey) || crypto.randomUUID();
let sessionHeartbeat;
function resetExpiredChecks() {
  let reset = false;
  items.forEach((item) => {
    if (item.doneDays.length && item.doneWeek !== currentWeekKey) {
      item.doneDays = [];
      item.doneWeek = null;
      reset = true;
    }
  });
  if (reset) void saveItems();
}
if (cloudSession && rememberedSession?.remaining > 0) {
  rememberedSession.remaining -= 1;
  localStorage.setItem(rememberSessionKey, JSON.stringify(rememberedSession));
} else if (cloudSession && !rememberedSession?.remaining) {
  cloudSession = null;
  localStorage.removeItem(cloudSessionKey);
}
async function supabaseRequest(path, options = {}) {
  const headers = { apikey: supabaseAnonKey, 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (!headers.Authorization) headers.Authorization = `Bearer ${cloudSession?.access_token || supabaseAnonKey}`;
  if (path === '/auth/v1/logout') await releaseAccountSession();
  const response = await fetch(`${supabaseUrl}${path}`, { ...options, headers });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.msg || error.message || error.error_description || 'Cloud request failed.'); }
  const responseText = await response.text();
  const result = responseText ? JSON.parse(responseText) : null;
  if ((path.startsWith('/auth/v1/token') || path.startsWith('/auth/v1/signup')) && result?.access_token) {
    cloudSession = result;
    localStorage.setItem(cloudSessionKey, JSON.stringify(cloudSession));
    if (!(await claimAccountSession())) {
      await fetch(`${supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${result.access_token}` } }).catch(() => {});
      cloudSession = null;
      localStorage.removeItem(cloudSessionKey);
      throw new Error('This account is already in use on another computer. Log out there first.');
    }
    localStorage.setItem(activeSessionKey, activeSessionId);
    startSessionHeartbeat();
  }
  return result;
}
async function claimAccountSession() {
  const result = await supabaseRequest('/rest/v1/rpc/claim_account_session', { method: 'POST', body: JSON.stringify({ p_session_id: activeSessionId }) });
  return result === true;
}
async function releaseAccountSession() {
  clearInterval(sessionHeartbeat);
  if (!cloudSession?.user?.id) return;
  await supabaseRequest('/rest/v1/rpc/release_account_session', { method: 'POST', body: JSON.stringify({ p_session_id: activeSessionId }) }).catch(() => {});
}
function startSessionHeartbeat() {
  clearInterval(sessionHeartbeat);
  sessionHeartbeat = setInterval(async () => {
    if (!account || !cloudSession) return;
    const claimed = await claimAccountSession().catch(() => false);
    if (!claimed) window.location.reload();
  }, 30000);
}
async function saveCloudProfile() {
  if (!cloudSession?.user?.id || !profile) return;
  await supabaseRequest('/rest/v1/profiles?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: cloudSession.user.id, email: profile.email, username: profile.username, name: profile.name, photo: profile.photo || null, items: normalizeItems(items), schedule_url: scheduleUrl, schedule_image: localStorage.getItem(scheduleImageKey), notifications: notifications.slice(0, 30) }) });
}
function urlBase64ToUint8Array(value) { const padding = '='.repeat((4 - value.length % 4) % 4); const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)); }
async function registerPushSubscription() {
  if (!vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window) || !cloudSession?.user?.id) return;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
  }
  await supabaseRequest('/rest/v1/push_subscriptions?on_conflict=user_id,endpoint', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: cloudSession.user.id, endpoint: subscription.endpoint, subscription: { ...subscription.toJSON(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }) });
}
const saveItems = async () => {
  if (cloudSession) { await saveCloudProfile(); return; }
  if (!activeAccountKey) return;
  accounts[activeAccountKey] = { ...accounts[activeAccountKey], ...profile, items: normalizeItems(items) };
  localStorage.setItem(accountsKey, JSON.stringify(accounts));
};
function updateAccountUI() {
  $('#account-name').textContent = accountName || 'Log in to your profile';
  $('#account-status').textContent = account ? profile?.email || 'Ready on this device' : 'No account signed in';
  $('#account-avatar').textContent = profile?.photo ? '' : accountName?.[0]?.toUpperCase() || '?';
  $('#account-avatar').style.backgroundImage = profile?.photo ? `url(${profile.photo})` : '';
  $('#account-action').textContent = account ? 'Log out' : 'Log in';
  $('#profile-settings').classList.toggle('hidden', !account);
  $('#greeting-name').textContent = accountName || 'there';
  $('#open-add').disabled = !account;
}
function saveNotifications() { localStorage.setItem(notificationKey, JSON.stringify(notifications.slice(0, 30))); if (cloudSession) void saveCloudProfile(); }
function renderNotifications() {
  const unread = notifications.filter((notification) => !notification.read).length;
  $('#notification-count').textContent = unread;
  $('#notification-count').classList.toggle('hidden', unread === 0);
  $('#notification-list').innerHTML = notifications.length ? notifications.map((notification) => `<article class="notification-entry ${notification.read ? '' : 'unread'}"><span class="notification-dot"></span><div><strong>${escapeHtml(notification.title)}</strong><p>${escapeHtml(notification.body)}</p><small>${escapeHtml(notification.time)}</small></div></article>`).join('') : '<p class="notification-empty">No reminders yet. They will appear here when a task is due.</p>';
}
function assistantReply(message) {
  const normalized = message.trim();
  if (!account) return 'Log in first so I can add tasks and reminders to your list.';
  const addMatch = normalized.match(/^(?:add|create)\s+(?:a\s+)?task\s*:\s*(.+)$/i);
  if (addMatch) {
    const rawTask = addMatch[1].trim();
    const reminderMatch = rawTask.match(/\s+(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    const taskName = (reminderMatch ? rawTask.slice(0, reminderMatch.index) : rawTask).trim();
    if (!taskName) return 'Tell me what to add, like “Add task: Pack library book”.';
    let reminderTime = '';
    if (reminderMatch) {
      let hour = Number(reminderMatch[1]);
      const minute = reminderMatch[2] || '00';
      const meridiem = reminderMatch[3]?.toLowerCase();
      if (meridiem) { if (meridiem === 'pm' && hour < 12) hour += 12; if (meridiem === 'am' && hour === 12) hour = 0; }
      if (hour > 23 || Number(minute) > 59) return 'That reminder time does not look right. Try “at 6:30 pm”.';
      reminderTime = `${String(hour).padStart(2, '0')}:${minute}`;
    }
    const days = [selectedDay];
    items.push({ id: Date.now(), name: taskName, days, doneDays: [], reminderDays: reminderTime ? days : [], reminderTime });
    void saveItems();
    if (reminderTime && 'Notification' in window && Notification.permission !== 'granted') void Notification.requestPermission().then(() => startReminderCheck());
    startReminderCheck();
    render();
    return reminderTime ? `Added “${taskName}” for ${dayLabel(selectedDay)} with a ${reminderTime} reminder.` : `Added “${taskName}” for ${dayLabel(selectedDay)}.`;
  }
  const visible = items.filter((item) => item.days.includes(selectedDay));
  if (/forget|prepare|today|list/i.test(normalized)) {
    const unfinished = visible.filter((item) => !item.doneDays.includes(selectedDay));
    const scheduleNote = assistantCanScanSchedule && scheduleUrl ? (scheduleText ? ` I found this schedule text locally: “${scheduleText.slice(0, 140)}${scheduleText.length > 140 ? '…' : ''}”.` : ' I can see the uploaded schedule, but it appears to be an image-only PDF, so I cannot reliably read class names from it yet.') : scheduleUrl ? ' Your schedule is uploaded, but schedule access is still off.' : ' Upload a schedule if you want it included in planning.';
    if (!unfinished.length) return `Everything on your ${dayLabel(selectedDay)} list is marked ready.${scheduleNote}`;
    return `For ${dayLabel(selectedDay)}, remember: ${unfinished.map((item) => item.name).join(', ')}.${scheduleNote}`;
  }
  if (/remind/i.test(normalized)) return 'Try “Add task: Pack library book at 6 pm” and I will create the reminder.';
  return 'I can help you prepare, check your list, add a task, or add a reminder. Try “Add task: Pack art supplies”.';
}
function openAssistant() {
  $('#assistant-permission').checked = assistantCanScanSchedule;
  $('#assistant-input').value = '';
  $('#assistant-response').textContent = scheduleUrl ? 'Your uploaded schedule is available when permission is on.' : 'Upload a schedule if you want it included in planning.';
  $('#assistant-dialog').showModal();
  $('#assistant-input').focus();
}
const dayLabel = (index) => dayNames[index];
const taskDayLabel = (index) => index === 3 ? 'Wed' : index === 4 ? 'Thu' : dayNames[index];

function render() {
  resetExpiredChecks();
  const visible = items.filter((item) => item.days.includes(selectedDay));
  $('#checklist-items').innerHTML = visible.map((item) => `<article class="check-item ${item.doneDays.includes(selectedDay) ? 'done' : ''}">
    <input class="check-box" type="checkbox" ${item.doneDays.includes(selectedDay) ? 'checked' : ''} data-id="${item.id}" aria-label="Mark ${item.name} ready" />
    <span class="item-name">${escapeHtml(item.name)}</span><span class="item-days">${item.days.map(dayLabel).join(' · ')}${item.reminderTime ? ` · notify ${item.reminderDays.map(dayLabel).join(', ')} at ${item.reminderTime}` : ''}</span>
    <button class="edit-item" data-edit="${item.id}" aria-label="Edit ${escapeHtml(item.name)} reminder">✎</button><button class="delete-item" data-delete="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">×</button>
  </article>`).join('');
  $('#empty-state').classList.toggle('hidden', visible.length > 0);
  $('#empty-state h3').textContent = account ? 'Nothing planned for this day' : 'Log in to see your checklist';
  $('#empty-state p').textContent = account ? 'Add an item and choose the days you need it.' : 'Log in or sign up to create and save tasks.';
  const ready = visible.filter((item) => item.doneDays.includes(selectedDay)).length;
  $('#progress-label').textContent = `${ready} of ${visible.length} ready`;
  $('#progress-bar').style.width = visible.length ? `${ready / visible.length * 100}%` : '0%';
  $('#focus-title').textContent = visible.length && ready === visible.length ? 'You are all set for today.' : `Your ${dayLabel(selectedDay)} morning, made lighter.`;
  $('#date-label').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const completedDays = new Set(items.flatMap((item) => item.doneDays));
  $('#streak-number').textContent = completedDays.size;
  $('#days').innerHTML = dayNames.map((name, index) => `<button class="day-card ${selectedDay === index ? 'selected' : ''} ${today === index ? 'today' : ''}" data-day="${index}">${name}<strong>${items.filter((item) => item.days.includes(index)).length}</strong></button>`).join('');
}
function escapeHtml(value) { return value.replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
function setupDayPicker(selector, selectedDays = []) { $(selector).innerHTML = dayNames.map((name, index) => `<label class="day-choice ${index === 0 || index === 6 ? 'weekend-choice' : ''}"><input type="checkbox" value="${index}" aria-label="${name}" ${selectedDays.includes(index) ? 'checked' : ''}/><span>${taskDayLabel(index)}</span></label>`).join(''); }
function openFilePicker() { $('#schedule-input').click(); }

let editingItemId = null;
function openItemDialog(item = null) { editingItemId = item?.id || null; setupDayPicker('#day-picker', item?.days || [1, 2, 3, 4, 5]); setupDayPicker('#reminder-day-picker', item?.reminderDays || item?.days || []); $('#item-dialog-title').textContent = item ? 'Edit task reminder' : 'Add to your list'; $('#item-submit').textContent = item ? 'Save changes' : 'Add item'; $('#item-name').value = item?.name || ''; $('#reminder-enabled').checked = Boolean(item?.reminderTime); $('#reminder-time').value = item?.reminderTime || '18:00'; $('#item-dialog').showModal(); $('#item-name').focus(); }
$('#open-add').addEventListener('click', () => { if (account) openItemDialog(); });
$('#open-assistant').addEventListener('click', openAssistant);
$('#assistant-permission').addEventListener('change', (event) => { assistantCanScanSchedule = event.target.checked; localStorage.setItem(assistantPermissionKey, String(assistantCanScanSchedule)); $('#assistant-response').textContent = assistantCanScanSchedule ? 'Schedule access is on for this browser.' : 'Schedule access is off.'; });
document.querySelectorAll('.prompt-button').forEach((button) => button.addEventListener('click', () => { $('#assistant-input').value = button.dataset.prompt; $('#assistant-form').requestSubmit(); }));
$('#assistant-form').addEventListener('submit', (event) => { event.preventDefault(); $('#assistant-response').textContent = assistantReply($('#assistant-input').value); });
$('#open-notifications').addEventListener('click', () => { notifications = notifications.map((notification) => ({ ...notification, read: true })); saveNotifications(); renderNotifications(); $('#notifications-dialog').showModal(); });
$('#clear-notifications').addEventListener('click', () => { notifications = []; saveNotifications(); renderNotifications(); });
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; $('#install-app').classList.remove('hidden'); });
$('#install-app').addEventListener('click', async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $('#install-app').classList.add('hidden'); });
$('#item-close').addEventListener('click', () => $('#item-dialog').close());
$('#item-cancel').addEventListener('click', () => $('#item-dialog').close());
$('#item-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#item-name').value.trim(); const days = [...document.querySelectorAll('#day-picker input:checked')].map((input) => Number(input.value)); const reminderDays = [...document.querySelectorAll('#reminder-day-picker input:checked')].map((input) => Number(input.value)); if (!name || !days.length || ($('#reminder-enabled').checked && !reminderDays.length)) return; const reminderTime = $('#reminder-enabled').checked ? $('#reminder-time').value : ''; if (reminderTime && 'Notification' in window && Notification.permission !== 'granted') { const permission = await Notification.requestPermission(); if (permission !== 'granted') $('#reminder-enabled').checked = false; } const updatedReminder = $('#reminder-enabled').checked ? reminderTime : ''; const updatedReminderDays = updatedReminder ? reminderDays : []; const existingItem = items.find((item) => item.id === editingItemId); if (existingItem) { existingItem.name = name; existingItem.days = days; existingItem.reminderDays = updatedReminderDays; existingItem.reminderTime = updatedReminder; } else { items.push({ id: Date.now(), name, days, doneDays: [], reminderDays: updatedReminderDays, reminderTime: updatedReminder }); } void saveItems(); if (updatedReminder && account && Notification.permission === 'granted') void registerPushSubscription().catch(() => {}); selectedDay = days.includes(selectedDay) ? selectedDay : days[0]; $('#item-dialog').close(); $('#item-form').reset(); editingItemId = null; startReminderCheck(); render(); });
$('#checklist-items').addEventListener('change', (event) => { if (!account) return; const item = items.find((entry) => entry.id === Number(event.target.dataset.id)); if (item) { item.doneDays = event.target.checked ? [...new Set([...item.doneDays, selectedDay])] : item.doneDays.filter((day) => day !== selectedDay); item.doneWeek = item.doneDays.length ? currentWeekKey : null; void saveItems(); render(); } });
$('#checklist-items').addEventListener('click', (event) => { if (!account) return; const editId = Number(event.target.dataset.edit); if (editId) { openItemDialog(items.find((item) => item.id === editId)); return; } const id = Number(event.target.dataset.delete); if (id) { items = items.filter((item) => item.id !== id); void saveItems(); render(); } });
$('#days').addEventListener('click', (event) => { const card = event.target.closest('[data-day]'); if (card) { selectedDay = Number(card.dataset.day); render(); } });
document.querySelectorAll('.nav-tab').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.nav-tab').forEach((tab) => tab.classList.remove('active')); document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active-panel')); button.classList.add('active'); $(`#${button.dataset.tab}`).classList.add('active-panel'); }));
$('#upload-trigger').addEventListener('click', openFilePicker); $('#upload-trigger-secondary').addEventListener('click', openFilePicker); $('#replace-schedule').addEventListener('click', openFilePicker);
$('#schedule-input').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file || file.type !== 'application/pdf') return; scheduleUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); }); localStorage.setItem(scheduleKey, scheduleUrl); localStorage.removeItem(scheduleImageKey); void showSchedule(scheduleUrl); void saveCloudProfile(); });
async function showSchedule(source) {
  const image = localStorage.getItem(scheduleImageKey);
  if (image) {
    $('#schedule-image').src = image;
  } else {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument(source).promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    scheduleText = textContent.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
    localStorage.setItem(scheduleTextKey, scheduleText);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const renderedImage = canvas.toDataURL('image/png');
    localStorage.setItem(scheduleImageKey, renderedImage);
    $('#schedule-image').src = renderedImage;
  }
  $('#schedule-image').classList.remove('hidden'); $('#schedule-placeholder').classList.add('hidden'); $('#schedule-footer').classList.remove('hidden');
}
$('#open-schedule').addEventListener('click', () => { if (scheduleUrl) window.open(scheduleUrl, '_blank', 'noopener,noreferrer'); });
let accountMode = 'login';
function openAccountDialog(mode = 'login') { accountMode = mode; const signup = mode === 'signup'; $('#account-dialog-title').textContent = signup ? 'Create your account' : 'Log in to your account'; $('#account-submit').textContent = signup ? 'Sign up' : 'Log in'; $('#account-name-field').textContent = 'Username'; $('#account-name-input').placeholder = 'e.g. Alex'; $('#account-name-input').required = true; $('#account-switch').textContent = signup ? 'Already have an account? Log in' : 'New here? Create an account'; $('#remember-me-label').classList.toggle('hidden', signup); $('#remember-me').checked = false; $('#account-name-input').value = ''; $('#account-email').value = ''; $('#account-password').value = ''; $('#account-password').type = 'password'; $('#toggle-account-password').textContent = 'View password'; $('#toggle-account-password').setAttribute('aria-pressed', 'false'); $('#account-error').textContent = ''; $('#account-dialog').showModal(); $('#account-name-input').focus(); }
$('#remember-me').addEventListener('change', () => { if ($('#remember-me').checked && accountMode === 'login') localStorage.setItem(rememberSessionKey, JSON.stringify({ remaining: 10 })); else localStorage.removeItem(rememberSessionKey); });
$('#toggle-account-password').addEventListener('click', () => { const passwordInput = $('#account-password'); const showing = passwordInput.type === 'text'; passwordInput.type = showing ? 'password' : 'text'; $('#toggle-account-password').textContent = showing ? 'View password' : 'Hide password'; $('#toggle-account-password').setAttribute('aria-pressed', String(!showing)); });
$('#account-action').addEventListener('click', async () => { if (account) { await saveItems(); if (cloudSession) { await supabaseRequest('/auth/v1/logout', { method: 'POST' }).catch(() => {}); localStorage.removeItem(cloudSessionKey); cloudSession = null; } localStorage.removeItem(rememberSessionKey); clearInterval(reminderTimer); localStorage.removeItem(profileKey); account = null; profile = null; accountName = ''; activeAccountKey = null; items = []; render(); updateAccountUI(); openAccountDialog('login'); return; } openAccountDialog('login'); });
$('#account-switch').addEventListener('click', () => { const mode = accountMode === 'login' ? 'signup' : 'login'; $('#account-dialog').close(); openAccountDialog(mode); });
async function hashPassword(password) { const data = new TextEncoder().encode(password); const hash = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
$('#account-form').addEventListener('submit', async (event) => { event.preventDefault(); const username = $('#account-name-input').value.trim(); const email = $('#account-email').value.trim().toLowerCase(); const password = $('#account-password').value; $('#account-error').textContent = ''; try { const endpoint = accountMode === 'login' ? '/auth/v1/token?grant_type=password' : `/auth/v1/signup${appRedirectUrl ? `?redirect_to=${encodeURIComponent(appRedirectUrl)}` : ''}`; const authResponse = await supabaseRequest(endpoint, { method: 'POST', body: JSON.stringify(accountMode === 'login' ? { email, password } : { email, password, data: { username, name: username } }) }); if (!authResponse?.access_token) { $('#account-error').textContent = 'Confirmation email sent. Check your inbox to finish creating your account.'; $('#account-password').value = ''; return; } cloudSession = authResponse; localStorage.setItem(cloudSessionKey, JSON.stringify(cloudSession)); const cloudProfiles = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(authResponse.user.id)}&select=*`); const fallbackUsername = username || email.split('@')[0] || 'User'; const fallbackName = username || email.split('@')[0] || 'User'; const profilePayload = { id: authResponse.user.id, email: authResponse.user.email || email, username: fallbackUsername, name: fallbackName, items: normalizeItems(accounts[email]?.items || savedItems || []), notifications: [], schedule_url: scheduleUrl || null, schedule_image: localStorage.getItem(scheduleImageKey) || null }; if (!cloudProfiles.length) { await supabaseRequest('/rest/v1/profiles?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(profilePayload) }); } profile = (await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(authResponse.user.id)}&select=*`))[0] || profilePayload; if (accountMode === 'login' && profile.username.toLowerCase() !== (username || profile.username).toLowerCase()) { if (username) { profile.username = username; profile.name = username; await saveCloudProfile(); } } activeAccountKey = authResponse.user.id; items = normalizeItems(profile.items); scheduleUrl = profile.schedule_url || null; if (profile.schedule_image) localStorage.setItem(scheduleImageKey, profile.schedule_image); notifications = Array.isArray(profile.notifications) ? profile.notifications : []; await saveCloudProfile(); account = true; accountName = profile.name; $('#account-dialog').close(); $('#account-form').reset(); updateAccountUI(); startReminderCheck(); void registerPushSubscription().catch(() => {}); render(); renderNotifications(); } catch (error) { cloudSession = null; localStorage.removeItem(cloudSessionKey); $('#account-error').textContent = error.message; } });
$('#profile-settings').addEventListener('click', () => { $('#settings-name').value = profile.name; $('#settings-email').value = profile.email || ''; $('#profile-photo').value = ''; $('#current-password').value = ''; $('#new-password').value = ''; $('#settings-error').textContent = ''; $('#settings-dialog').showModal(); });
$('#settings-form').addEventListener('submit', async (event) => { event.preventDefault(); const newName = $('#settings-name').value.trim(); const newEmail = $('#settings-email').value.trim(); const photo = $('#profile-photo').files[0]; profile.name = newName; profile.username = newName; profile.email = newEmail; if (photo) profile.photo = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(photo); }); try { await saveCloudProfile(); accountName = profile.name; updateAccountUI(); startReminderCheck(); $('#settings-dialog').close(); } catch (error) { $('#settings-error').textContent = error.message; } });
function startReminderCheck() { clearInterval(reminderTimer); if (!account || !('Notification' in window) || Notification.permission !== 'granted') return; const checkReminders = () => { const now = new Date(); const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; const dateKey = now.toLocaleDateString('en-CA'); items.filter((item) => item.reminderDays.includes(now.getDay()) && item.reminderTime <= time && !item.doneDays.includes(now.getDay())).forEach((item) => { const key = `${item.id}-${dateKey}-${item.reminderTime}`; if (notifications.some((notification) => notification.key === key)) return; notifications.unshift({ key, title: 'Ready Set School', body: `Remember: ${item.name}`, time: now.toLocaleString(), read: false }); saveNotifications(); renderNotifications(); new Notification('Ready Set School', { body: `Remember: ${item.name}` }); }); }; checkReminders(); reminderTimer = setInterval(checkReminders, 60000); }
async function restoreAuthRedirect() { const hash = new URLSearchParams(window.location.hash.slice(1)); const accessToken = hash.get('access_token'); if (!accessToken) return; const refreshToken = hash.get('refresh_token'); const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` } }); if (!response.ok) return; cloudSession = { access_token: accessToken, refresh_token: refreshToken, user: await response.json() }; localStorage.setItem(cloudSessionKey, JSON.stringify(cloudSession)); window.history.replaceState({}, document.title, window.location.pathname + window.location.search); }
async function restoreCloudSession() { if (!cloudSession?.access_token || !cloudSession.user?.id) return; try { if (!(await claimAccountSession())) throw new Error('This account is already in use on another computer.'); const cloudProfiles = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(cloudSession.user.id)}&select=*`); if (!cloudProfiles.length) throw new Error('Profile not found.'); profile = cloudProfiles[0]; activeAccountKey = cloudSession.user.id; items = normalizeItems(profile.items); scheduleUrl = profile.schedule_url || null; if (profile.schedule_image) localStorage.setItem(scheduleImageKey, profile.schedule_image); notifications = Array.isArray(profile.notifications) ? profile.notifications : []; account = true; accountName = profile.name; localStorage.setItem(activeSessionKey, activeSessionId); startSessionHeartbeat(); startReminderCheck(); void registerPushSubscription().catch(() => {}); } catch (error) { cloudSession = null; localStorage.removeItem(cloudSessionKey); clearInterval(sessionHeartbeat); }
}
restoreAuthRedirect().finally(() => restoreCloudSession()).finally(() => { updateAccountUI(); if (!account) setTimeout(() => openAccountDialog('login'), 300); if (scheduleUrl) void showSchedule(scheduleUrl); render(); renderNotifications(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=5');
