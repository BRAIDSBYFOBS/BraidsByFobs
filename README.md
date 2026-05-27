# Braids By Fobs

A marketing site + online booking platform for a hair-braiding business.
Acuity-style flow: browse styles → pick a date & time → pay deposit → confirmation.

- **Front-end:** plain HTML / CSS / vanilla JavaScript (no build step)
- **Database / Auth:** Firebase (Firestore + Auth)
- **Payments:** Stripe via Firebase Cloud Functions
- **Hosting:** GitHub Pages (static front-end) + Firebase (Functions only)
- **Images:** committed to `images/` inside the repo (no cloud storage)

---

## Project structure

```
.
├── index.html                  # Landing page
├── pages/
│   ├── styles.html             # Full gallery
│   ├── style.html              # Style detail (?id=...)
│   ├── book.html               # Booking flow (3 steps)
│   ├── success.html            # Post-booking confirmation
│   ├── login.html / signup.html
│   ├── account.html            # Customer's bookings
│   ├── admin.html              # Admin dashboard
│   └── seed.html               # One-time Firestore seeder (admin only)
├── styles/main.css             # All site styles
├── scripts/
│   ├── firebase-config.js      # YOUR Firebase config goes here
│   ├── common.js               # Nav, footer, auth guards, helpers
│   ├── styles-data.js          # Loads styles from Firestore (or seed fallback)
│   └── booking.js              # Acuity-style booking flow
├── images/
│   └── styles/                 # Drop your hairstyle photos here
├── data/
│   └── seed-styles.json        # Sample style catalogue
├── functions/                  # Stripe Cloud Functions
│   ├── index.js
│   └── package.json
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── .firebaserc
└── .github/workflows/pages.yml # Auto-deploy to GitHub Pages
```

---

## Quick start (local preview, no Firebase yet)

Because there's no build step, you can preview the site by opening it through any
static server. (Opening `index.html` directly with `file://` won't work — ES modules
require HTTP.)

**PowerShell:**
```powershell
# Python 3
python -m http.server 5500
# Then open http://localhost:5500
```

**Node:**
```powershell
npx serve -l 5500
```

Without Firebase configured, the site will:
- ✅ render all pages
- ✅ show styles from `data/seed-styles.json`
- ✅ let you walk the entire booking flow
- ✅ land on the success page in "demo mode"
- ❌ not save bookings or process payments

---

## 1. Set up Firebase

1. Create a project at https://console.firebase.google.com.
2. In **Project settings → General → Your apps**, register a Web app.
   Copy the `firebaseConfig` object.
3. Open `scripts/firebase-config.js` and replace the placeholders with your config.
4. Set your admin email(s):

   ```js
   export const ADMIN_EMAILS = ["you@yourdomain.com"];
   ```

   Then also edit `firestore.rules` and put the same email(s) in the `isAdmin()`
   helper at the top of the file.

5. In Firebase console:
   - Enable **Authentication → Sign-in method** → Email/Password and Google.
   - Enable **Firestore Database** (start in production mode).

6. Install the Firebase CLI if you don't have it:
   ```powershell
   npm install -g firebase-tools
   firebase login
   ```

7. Wire this repo to your Firebase project:
   - Open `.firebaserc`, replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with your
     project ID (the one in the Firebase URL, not the display name).

8. Deploy rules & indexes:
   ```powershell
   firebase deploy --only firestore:rules,firestore:indexes
   ```

9. **Seed your styles.** Sign up on your live site with your admin email, then visit
   `pages/seed.html` and click **Run seed**. This copies `data/seed-styles.json` into
   the `styles` collection. After that, manage styles from `pages/admin.html`.

---

## 2. Add your photos

All photos live in the GitHub repo (not in cloud storage) — the same place
that powers GitHub Pages. There are two folders:

- `images/styles/` — one photo per hairstyle (referenced from the Styles tab)
- `images/site/` — homepage hero, about photo, optional CTA banner image

The seed file references these style filenames:

```
knotless-medium.jpg
knotless-small.jpg
boho-knotless.jpg
feed-in-cornrows.jpg
passion-twists.jpg
senegalese-twists.jpg
starter-locs.jpg
loc-retwist.jpg
kids-braids.jpg
```

If an image is missing, the card falls back to a styled placeholder with the
style name — so nothing breaks if you upload them one at a time.

Recommended size: **800×1000 px** (4:5 aspect ratio), JPEG, < 300 KB each.

### How an admin uploads a new photo

Two paths — pick whichever you prefer. The admin dashboard adapts automatically
based on whether the upload Cloud Function is configured.

#### Easy mode — file picker in the admin (recommended)

Once you've completed the **Cloud Function setup** below, the Styles and Site
tabs show a regular file picker. The admin clicks **Choose file**, picks a
photo from their device, and the function commits it straight into
`images/styles/` or `images/site/` in the repo. GitHub Pages republishes in
~1–2 minutes and the photo is live.

#### Manual mode (no Functions needed)

Set `GITHUB_REPO` in `scripts/firebase-config.js` and the admin gets an
**"Upload a photo to GitHub →"** link on each image field. The link opens
GitHub's drag-and-drop upload page targeted at the right folder; commit there
and type the filename into the admin form.

You can also push to `images/styles/` or `images/site/` from a local clone.

### Cloud Function setup (for the file-picker upload flow)

The `uploadImage` Cloud Function commits images to your repo on the admin's
behalf using a GitHub Personal Access Token that's stored server-side.

1. **Create a fine-grained PAT.**
   - Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
   - "Resource owner" = whoever owns the site repo.
   - "Repository access" → **Only select repositories** → pick the site repo.
   - "Repository permissions" → **Contents: Read and write**.
   - Copy the generated token (starts with `github_pat_...`). It's shown
     once — keep it for the next step.

2. **Store the token as a Firebase secret:**
   ```powershell
   cd functions
   firebase functions:secrets:set GITHUB_TOKEN
   ```
   Paste the PAT when prompted.

3. **Tell the function which repo to commit to.** Copy
   `functions/.env.example` to `functions/.env` and edit:
   ```
   GITHUB_REPO=blessingfobs/BraidsByFobs
   GITHUB_BRANCH=main
   ```
   (`functions/.env` is git-ignored.)

4. **Deploy:**
   ```powershell
   firebase deploy --only functions
   ```
   At the end of the deploy, copy the printed URL for `createCheckoutSession`
   (e.g. `https://us-central1-yourproj.cloudfunctions.net/createCheckoutSession`).
   Set its host portion as `FUNCTIONS_BASE_URL` in `scripts/firebase-config.js`:
   ```js
   export const FUNCTIONS_BASE_URL = "https://us-central1-yourproj.cloudfunctions.net";
   ```

5. **Sanity check.** Sign in to the site as an admin, open
   `pages/admin.html` → Styles → Edit any style. You should see a regular
   file picker labelled "Pick a photo — it gets committed to images/styles/
   in the repo." Pick a small JPG; within a couple of seconds the form fills
   in a path like `images/styles/1716...-photo.jpg`. Check the repo on GitHub
   to confirm the new commit. GitHub Pages will republish automatically.

> **Note on plans.** Cloud Functions require the Firebase **Blaze**
> (pay-as-you-go) plan. The free tier is generous; for a single-business
> site you'll almost certainly stay at $0.

If you later rotate the PAT, just re-run
`firebase functions:secrets:set GITHUB_TOKEN` and redeploy functions.

---

## 3. Set up Stripe (optional, but needed for real payments)

> Cloud Functions require the Firebase **Blaze (pay-as-you-go)** plan. The free
> tier is generous; you only pay if you have heavy usage.

1. Create a Stripe account and grab your **secret key** from the dashboard.
2. Store it as a Firebase secret:
   ```powershell
   cd functions
   npm install
   cd ..
   firebase functions:secrets:set STRIPE_SECRET_KEY
   ```
3. Deploy the functions:
   ```powershell
   firebase deploy --only functions
   ```
4. In the Stripe dashboard, add a webhook endpoint pointing to your deployed
   `stripeWebhook` URL (it's printed at the end of the deploy). Subscribe it to
   `checkout.session.completed`. Copy the signing secret, then:
   ```powershell
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   firebase deploy --only functions
   ```
5. Copy your `createCheckoutSession` URL (printed after deploy) into
   `scripts/firebase-config.js`:
   ```js
   export const FUNCTIONS_BASE_URL = "https://us-central1-YOUR-PROJECT.cloudfunctions.net";
   ```

Now the booking flow will redirect through Stripe Checkout for the deposit.

---

## 4. Deploy the front-end to GitHub Pages

Two options.

### Option A — Auto-deploy via GitHub Actions (recommended)

The workflow at `.github/workflows/pages.yml` is already set up. Just:

1. Push this repo to GitHub.
2. In the repo, **Settings → Pages → Build and deployment → Source**: select
   **GitHub Actions**.
3. Push to `main`. The workflow runs and your site goes live at
   `https://<your-username>.github.io/<repo-name>/`.

### Option B — Use the `docs/` folder or manual deploy

If you prefer to skip GitHub Actions, configure Pages to serve from the root of
`main`. The site is plain static files, so it works as-is.

> **CORS heads-up.** After your Pages URL is known, add it to `ALLOWED_ORIGINS`
> in `functions/index.js` and redeploy functions. The wildcard `*.github.io`
> match is already permitted, so this is optional unless you use a custom domain.

---

## How the booking flow works

`scripts/booking.js` drives a three-step wizard:

1. **Pick style** — pulled from Firestore (`styles` collection) or seed file.
2. **Pick date & time** — generates 30-minute slots from business hours
   (configurable in `DEFAULT_HOURS` at the top of `booking.js`), filters out:
   - past times,
   - days marked `closed` in `availability/{YYYY-MM-DD}`,
   - slots that overlap any existing non-cancelled booking on that day.
3. **Customer info + checkout** — writes a `pending` booking to Firestore, then
   redirects to Stripe Checkout. The Stripe webhook flips the booking to
   `confirmed` once the deposit is paid.

The Firestore security rules in `firestore.rules` ensure:
- Anyone can browse styles & availability.
- Anyone can create a `pending` / `unpaid` booking (so guest checkout works).
- Customers see only their own bookings; admins see all.
- Only admins can mutate styles/availability or override booking status.

---

## Data model

```
styles/{id}
  name, category, priceCents, depositCents, durationMin
  image, shortDesc, description, includes[], featured, active

bookings/{auto-id}
  userId | null
  customer: { name, email, phone, notes }
  styleId, styleName, priceCents, depositCents, durationMin
  startAt, endAt              (Firestore Timestamp)
  status: pending | confirmed | completed | cancelled
  paymentStatus: unpaid | deposit_paid
  stripeSessionId, paidAt, createdAt

availability/{YYYY-MM-DD}
  closed: bool
  open: 0-23 (hour)
  close: 1-23 (hour)

users/{uid}
  email, name, phone, createdAt

site/content                      (singleton — edited from Admin → Site)
  brandName, hero{}, features[], about{}, testimonials{ items[] },
  cta{}, contact{}

inventory/{auto-id}               (Admin → Inventory)
  name, category, sku, qty, unitCostCents, reorderAt, supplier, notes

expenses/{auto-id}                (Admin → Expenses)
  date (Timestamp), category, vendor, amountCents, description, notes
```

---

## Common tasks

| Task                                | Where                                           |
|-------------------------------------|--------------------------------------------------|
| Add / edit a hairstyle              | `pages/admin.html` → Styles → Edit               |
| Add a hairstyle photo               | Drop file in `images/styles/` (or use "Upload a photo to GitHub →" link in admin), then enter the filename in Styles → Edit |
| Edit homepage copy (hero, about, testimonials, CTA, contact) | `pages/admin.html` → Site |
| Replace hero / about / CTA banner photo | Drop file in `images/site/` then set the path in `pages/admin.html` → Site |
| Track supplies & low-stock alerts   | `pages/admin.html` → Inventory                   |
| Log expenses & see monthly forecast | `pages/admin.html` → Expenses                    |
| Mark a date closed                  | `pages/admin.html` → Availability                |
| Confirm or cancel a booking         | `pages/admin.html` → Bookings → status dropdown  |
| Change business hours               | `DEFAULT_HOURS` in `scripts/booking.js`          |
| Change brand colors / fonts         | CSS variables at the top of `styles/main.css`    |
| Add a new admin                     | `ADMIN_EMAILS` in `scripts/firebase-config.js` **and** `isAdmin()` in `firestore.rules` |

---

## Troubleshooting

- **"Couldn't load styles"** on first load → either Firestore rules aren't
  deployed yet, or the `styles` collection is empty. Either run the seeder at
  `pages/seed.html` or rely on the JSON fallback (which works out of the box).
- **`auth/unauthorized-domain`** on Google sign-in → add your GitHub Pages
  domain in Firebase Console → Authentication → Settings → Authorized domains.
- **Stripe redirect shows demo banner** → `FUNCTIONS_BASE_URL` is empty. Set it
  in `scripts/firebase-config.js` after deploying functions.
- **CORS error from `createCheckoutSession`** → add your origin to
  `ALLOWED_ORIGINS` in `functions/index.js` and redeploy functions.
- **Firestore index error in console** → run
  `firebase deploy --only firestore:indexes`.

---

## License

All code and copy in this repository is original to this project. Hairstyle
photos you upload to `images/styles/` must be ones you own or are licensed to
use.
