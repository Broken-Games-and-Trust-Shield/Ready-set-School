# Ready Set School — Full Code Layout

This file is a project blueprint showing how the app is organized across files and the main responsibilities of each part.

## 1) Project structure

- `index.html` — page structure and dialogs
- `styles.css` — visual design and layout
- `app.js` — app logic, state, auth, checklist, reminders, schedule management
- `sw.js` — service worker for offline caching and push notifications
- `manifest.json` — installable PWA metadata
- `supabase-schema.sql` — PostgreSQL schema and Row Level Security policies
- `supabase/functions/send-reminders/index.ts` — scheduled reminder worker

---

## 2) HTML structure (`index.html`)

The page loads the app shell, nav tabs, checklist panel, schedule panel, dialogs, and script entry:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#18382f" />
    <title>Ready Set School | Accounts + Reminders</title>
    <link rel="manifest" href="manifest.json" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">...</div>
        <nav class="nav-tabs" aria-label="Main navigation">
          <button class="nav-tab active" data-tab="checklist">My checklist</button>
          <button class="nav-tab" data-tab="schedule">My schedule</button>
        </nav>
        <div class="account-panel">
          <div class="account-avatar" id="account-avatar">?</div>
          <div class="account-copy">
            <strong id="account-name">Set up your profile</strong>
            <small id="account-status">Name and password</small>
          </div>
          <button class="account-button" id="account-action" type="button">Log out</button>
          <button class="account-settings-button" id="profile-settings" type="button">Profile settings</button>
        </div>
      </aside>

      <main class="main-content">
        <section id="checklist" class="tab-panel active-panel">
          <header class="page-header">...</header>
          <section class="today-banner">...</section>
          <div class="section-heading">...</div>
          <div id="checklist-items" class="checklist-items"></div>
          <div id="empty-state" class="empty-state hidden">...</div>
        </section>

        <section id="schedule" class="tab-panel">
          <header class="page-header schedule-header">...</header>
          <div class="schedule-stage" id="schedule-stage">
            <div class="schedule-placeholder" id="schedule-placeholder">...</div>
            <img id="schedule-image" class="schedule-image hidden" alt="Uploaded school schedule" />
          </div>
        </section>
      </main>
    </div>

    <dialog id="item-dialog">...</dialog>
    <dialog id="account-dialog">...</dialog>
    <dialog id="settings-dialog">...</dialog>
    <dialog id="notifications-dialog">...</dialog>

    <script type="module" src="app.js?v=20260826-single-session"></script>
  </body>
</html>
```

The HTML is mostly a shell. The real behavior is driven by `app.js`.

---

## 3) Styling (`styles.css`)

The CSS handles the app theme, layout, cards, dialogs, mobile responsiveness, and notification UI.

Key sections in the stylesheet:

```css
:root {
  --ink:#18231f;
  --muted:#71807a;
  --paper:#f7f8f3;
  --line:#dfe5dc;
  --mint:#dceee4;
  --green:#2c765e;
  --yellow:#f8cf6b;
  --white:#fff;
  --coral:#f18d72;
}

body {
  margin:0;
  color:var(--ink);
  background:var(--paper);
  font-family:'DM Sans',sans-serif;
}

.app-shell {
  min-height:100vh;
  display:grid;
  grid-template-columns:245px 1fr;
}

.check-item {
  display:flex;
  align-items:center;
  gap:15px;
  background:var(--white);
  border:1px solid var(--line);
  border-radius:11px;
  padding:15px 17px;
}

.day-card.selected {
  background:var(--green);
  border-color:var(--green);
  color:#d5ede0;
}

dialog {
  border:0;
  border-radius:15px;
  padding:0;
  width:min(440px,calc(100% - 32px));
  box-shadow:0 25px 70px #18382f35;
}
```

This stylesheet defines the app’s visual identity and responsive behavior.

---

## 4) App logic (`app.js`)

This is the heart of the application. It contains state, rendering, authentication, reminders, schedule upload, and sync logic.

### Core app state

```js
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
let notifications = JSON.parse(localStorage.getItem(notificationKey) || '[]');
```

### Render and UI updates

```js
function render() {
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
}
```

### Add/edit item flow

```js
function openItemDialog(item = null) {
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
});
```

### Auth and Supabase session flow

```js
async function supabaseRequest(path, options = {}) {
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
});
```

### Reminder scheduling and notifications

```js
function startReminderCheck() {
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
}
```

### Schedule upload flow

```js
$('#schedule-input').addEventListener('change', async (event) => {
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
```

The app logic is a single-client app with state stored locally and synced to Supabase when an account is active.

---

## 5) Service worker (`sw.js`)

This file enables offline use and receives background push notifications.

```js
const cacheName = 'ready-set-school-v6-single-session';
const appFiles = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icon-192.svg', './icon-512.svg'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(appFiles)));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }

  const title = data.title || 'Ready Set School';
  const options = {
    body: data.body || 'You have a school reminder.',
    icon: './icon-192.svg',
    badge: './icon-192.svg',
    tag: data.tag || 'ready-set-school-reminder',
    data: { url: data.url || './' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
```

---

## 6) Database schema (`supabase-schema.sql`)

This file creates support tables for user profiles, push subscriptions, reminders sent, and account session locking.

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null,
  name text not null,
  photo text,
  items jsonb not null default '[]'::jsonb,
  schedule_url text,
  schedule_image text,
  notifications jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists public.sent_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  reminder_date date not null,
  reminder_time time not null,
  primary key (user_id, item_id, reminder_date, reminder_time)
);
```

---

## 7) Reminder backend (`supabase/functions/send-reminders/index.ts`)

This worker checks active reminders and sends push notifications through the web-push library.

```ts
import webpush from 'npm:web-push@3.6.7';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const vapidSubject = Deno.env.get('VAPID_SUBJECT')!;
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

Deno.serve(async () => {
  const now = new Date();
  const profiles = await supabaseRequest('profiles?select=id,items');
  let sent = 0;

  for (const profile of profiles || []) {
    const subscriptions = await supabaseRequest(`push_subscriptions?user_id=eq.${profile.id}&select=endpoint,subscription`);
    for (const subscription of subscriptions || []) {
      for (const item of profile.items || []) {
        if (!item.reminderTime || item.reminderTime > currentTime || !(item.reminderDays || []).includes(day)) continue;
        try {
          await webpush.sendNotification(subscription.subscription, JSON.stringify({
            title: 'Ready Set School',
            body: `Remember: ${item.name}`
          }));
          sent += 1;
        } catch (error) {
          // delete stale push subscription if needed
        }
      }
    }
  }

  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
```

---

## 8) How the app fits together

1. `index.html` creates the app layout and dialogs.
2. `styles.css` styles the interface.
3. `app.js` drives rendering, item management, auth, and reminder state.
4. `sw.js` handles offline caching and push notifications.
5. `supabase-schema.sql` stores user profiles and reminder metadata.
6. `send-reminders/index.ts` sends reminder pushes when a scheduled time is reached.

This is the full project layout, even though the real browser-side logic is primarily in `app.js` plus the supporting files around it.
