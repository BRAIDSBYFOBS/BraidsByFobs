# Firebase Setup — Step by Step

This guide walks you from "fresh Google account" to "site is fully wired to a
live Firebase project." Allow about **30–45 minutes** the first time.

> **Heads-up.** Firebase Console redesigns its menus every so often. If a
> button label doesn't match exactly, look for one nearby with similar wording.
> The order of operations does not change.

---

## Prerequisites

Before you start, make sure you have:

- A Google account you're happy to use as the project owner.
- **Node.js 20 or newer** installed → check with `node -v`.
  Download: https://nodejs.org
- A terminal you can run commands in (PowerShell on Windows is fine).
- This project opened in your editor.

Install the Firebase CLI once (skip if `firebase --version` already prints a version):

```powershell
npm install -g firebase-tools
firebase login
```

`firebase login` opens a browser tab — sign in with the same Google account
you'll use for the project.

---

## 1.1 — Create a Firebase project

1. Go to https://console.firebase.google.com.
2. Click **"Create a project"** (or **"Add project"** if you already have others).
3. **Project name:** `braids-by-fobs`
   - Firebase will suggest a project ID under the name (e.g.
     `braids-by-fobs-a1b2c`). **Write this ID down** — you need it in step 1.5.
     If you don't like the suggestion, click the pencil icon to edit it before
     continuing.
4. Click **Continue**.
5. **Google Analytics:** for a small business site, you can disable it. Click
   the toggle off and **Continue**. (You can always add it later.)
6. Wait ~30 seconds for the project to provision, then click **Continue**.

You should now be on the Firebase Console dashboard for your new project.

### Register a Web app inside the project

7. On the dashboard, look for the **"Get started by adding Firebase to your app"** row.
   Click the **`</>`** (Web) icon.
8. **App nickname:** `braids-web` (this is internal — won't show to users).
9. **Do not** check "Also set up Firebase Hosting" (we're using GitHub Pages
   for hosting, not Firebase Hosting).
10. Click **Register app**.
11. Firebase shows you a code snippet with a `const firebaseConfig = { ... }`
    object. **Keep this tab open** — you'll copy values from it in step 1.2.
12. Click **Continue to console**.

---

## 1.2 — Paste real config values into `scripts/firebase-config.js`

If you closed the tab from step 1.1, get the config back:

- Click the **⚙ gear icon** (top left, next to "Project Overview").
- Choose **Project settings**.
- Scroll to the **"Your apps"** section.
- Under your web app, the config snippet is shown. If it's collapsed, click
  the **"Config"** radio button.

You'll see something like:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...long-string...",
  authDomain: "braids-by-fobs-a1b2c.firebaseapp.com",
  projectId: "braids-by-fobs-a1b2c",
  storageBucket: "braids-by-fobs-a1b2c.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456"
};
```

Now in your editor, open `scripts/firebase-config.js` and replace the
placeholder block (around lines 24–31) so it matches your real values:

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...long-string...",
  authDomain: "braids-by-fobs-a1b2c.firebaseapp.com",
  projectId: "braids-by-fobs-a1b2c",
  storageBucket: "braids-by-fobs-a1b2c.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456"
};
```

> **Is this safe to commit?** Yes. These keys identify your project but do not
> grant access — security comes from Firestore rules and Auth. (The thing
> you must never commit is your **Stripe secret key** or a Firebase **service
> account JSON**.)

Save the file.

---

## 1.3 — Set your admin email in `scripts/firebase-config.js`

In the same file, find the line:

```js
export const ADMIN_EMAILS = ["owner@braidsbyfobs.com"];
```

Replace it with the email you'll use to sign in to the admin dashboard:

```js
export const ADMIN_EMAILS = ["you@yourdomain.com"];
```

- Use lowercase. The check is case-sensitive.
- You can list more than one: `["a@x.com", "b@x.com"]`.
- For Google sign-in, this must be the Gmail address you'll click through with.
- For email/password sign-in, this is the email you'll register on the site.

Save the file.

---

## 1.4 — Match the admin email in `firestore.rules`

Open `firestore.rules`. Near the top you'll see:

```
&& request.auth.token.email in [
     'owner@braidsbyfobs.com'
   ];
```

Replace `owner@braidsbyfobs.com` with the **exact same email** you used in
step 1.3. If you used multiple admins, list them comma-separated:

```
&& request.auth.token.email in [
     'you@yourdomain.com',
     'partner@yourdomain.com'
   ];
```

> **Why two places?** `ADMIN_EMAILS` controls what the *UI* shows (so non-admins
> don't see admin links). `isAdmin()` in the rules is the *actual* security
> check the database enforces. The first is convenience; the second is the lock.

Save the file.

---

## 1.5 — Set the Firebase project ID in `.firebaserc`

Open `.firebaserc` in the project root. It looks like:

```json
{
  "projects": {
    "default": "REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID"
  }
}
```

Replace the placeholder with the **project ID** from step 1.1 (the lowercase
one with the random suffix, *not* the friendly project name).

```json
{
  "projects": {
    "default": "braids-by-fobs-a1b2c"
  }
}
```

If you forgot the ID, get it from the Firebase Console → ⚙ Project settings
→ **Project ID** field.

Save the file.

---

## 1.6 — Enable Email/Password and Google sign-in

1. In Firebase Console, click **Build** in the left sidebar (it may be
   collapsed under a hamburger menu).
2. Click **Authentication**.
3. Click **Get started** (only shown the first time).
4. You land on the **"Sign-in method"** tab. (If not, click that tab.)
5. **Enable Email/Password:**
   - Click **Email/Password** in the providers list.
   - Toggle the first switch (**Email/Password**) to **Enabled**.
   - Leave "Email link (passwordless sign-in)" **off**.
   - Click **Save**.
6. **Enable Google:**
   - Click **Add new provider** → **Google**.
   - Toggle **Enable** to on.
   - **Project support email:** pick your admin email from the dropdown.
   - Click **Save**.
7. **Authorized domains.** Still in Authentication, click the **Settings** tab,
   then **Authorized domains**. You should already see `localhost` and your
   project's `*.firebaseapp.com` and `*.web.app` domains.
   - Once you deploy to GitHub Pages (step 4 in the main README), come back
     here and click **Add domain** → enter `your-username.github.io`. Without
     this, Google sign-in will reject the production site.

---

## 1.7 — Create the Firestore database

1. In the left sidebar, click **Build** → **Firestore Database**.
2. Click **Create database**.
3. **Location:** pick the region closest to your customers.
   - North America: `nam5 (us-central)` is a safe default.
   - **Pick carefully — this cannot be changed later.**
4. Click **Next**.
5. **Security rules:** select **"Start in production mode"**.
   - (Test mode opens the database to the world for 30 days — we don't need
     that because we're shipping real rules in the next step.)
6. Click **Create**. Wait ~30 seconds for provisioning.

You'll land on the Data tab with an empty database. That's expected — we'll
populate it from the seeder page later.

---

## 1.8 — Deploy rules + indexes

Back in your terminal, from the project root:

```powershell
cd "C:\Users\hotch\OneDrive - Conestoga College\Documents\GitHub\Acuity Fobs"
firebase use --add
```

When prompted, pick your project from the list and accept the default alias
(`default`). This links the folder to your Firebase project.

> If `firebase use --add` says you're already linked, you can skip it.

Now push the rules and indexes:

```powershell
firebase deploy --only firestore:rules,firestore:indexes
```

Expected output:

```
=== Deploying to 'braids-by-fobs-a1b2c'...

i  deploying firestore
i  firestore: reading indexes from firestore.indexes.json...
i  cloud.firestore: checking firestore.rules for compilation errors...
✔  cloud.firestore: rules file firestore.rules compiled successfully
i  firestore: deploying indexes...
✔  firestore: deployed indexes in firestore.indexes.json successfully
i  firestore: latest version of firestore.rules already up to date, skipping upload...
✔  firestore: released rules firestore.rules to cloud.firestore

✔  Deploy complete!
```

If you see a compilation error, it's almost always a typo in the admin email
list in step 1.4 — double-check the quotes and commas.

> **Indexes take 1–5 minutes to build** in the background even after the deploy
> command returns. If the **My Bookings** page errors out the first time you
> use it with a message about "missing index," wait a couple minutes and refresh.

---

## You're done with section 1

Sanity check by running the site locally:

```powershell
python -m http.server 5500
```

Then open http://localhost:5500. You should see:

- Landing page loads instantly (still pulling from the seed file because no
  one's signed up yet).
- DevTools Console shows **no** "Firestore unavailable" warning anymore.
- Visit **Login → Sign up**, create an account with your admin email.
- The nav now shows **Admin** and **My Account** links.
- Visit `http://localhost:5500/pages/seed.html` → click **Run seed** → the 9
  styles get copied into Firestore. From here on, the site reads from your
  real database.

---

## What's next

See the main `README.md` sections **3. Set up Stripe**, **4. Deploy the
front-end to GitHub Pages**, and `.notes/ROADMAP.md` for the full to-do list.
