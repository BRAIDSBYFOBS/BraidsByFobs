// Cloud Functions for Braids By Fobs
// ------------------------------------------------------------
// Active endpoint (deploy now — no Stripe needed):
//   POST /uploadImage  -> admin-only: commits an image into the GitHub repo
//
// Stripe endpoints live in stripe.js and are NOT loaded until you add payments.
// See stripe.js for setup when you're ready.
//
// Deploy image upload only:
//   1. firebase functions:secrets:set GITHUB_TOKEN
//   2. Edit functions/.env → GITHUB_REPO=owner/repo, GITHUB_BRANCH=main
//   3. firebase deploy --only functions:uploadImage

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const { admin, setCors } = require("./shared");

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const ADMIN_EMAILS = new Set(["blessingfobs@gmail.com"]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_FOLDERS = new Set(["styles", "site"]);
const FILENAME_RE = /^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|gif)$/i;

exports.uploadImage = onRequest(
  { secrets: [GITHUB_TOKEN] },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      if (!GITHUB_REPO) {
        return res.status(500).json({
          error: "Server not configured: set GITHUB_REPO in functions/.env and redeploy."
        });
      }

      const authHeader = req.get("Authorization") || "";
      const tokenMatch = authHeader.match(/^Bearer (.+)$/);
      if (!tokenMatch) {
        return res.status(401).json({ error: "Missing Authorization bearer token" });
      }
      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(tokenMatch[1]);
      } catch (err) {
        return res.status(401).json({ error: "Invalid auth token" });
      }
      const email = (decoded.email || "").toLowerCase();
      if (!ADMIN_EMAILS.has(email) || !decoded.email_verified) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { folder, filename, contentBase64, contentType } = req.body || {};
      if (!ALLOWED_FOLDERS.has(folder)) {
        return res.status(400).json({ error: `Invalid folder: ${folder}` });
      }
      if (typeof filename !== "string" || !FILENAME_RE.test(filename)) {
        return res.status(400).json({ error: "Invalid filename (alphanumeric, dot, dash, underscore only; JPG/PNG/WEBP/GIF)" });
      }
      if (typeof contentBase64 !== "string" || !contentBase64.length) {
        return res.status(400).json({ error: "Missing image data" });
      }
      if (typeof contentType !== "string" || !/^image\//.test(contentType)) {
        return res.status(400).json({ error: "Not an image content type" });
      }
      const approxBytes = Math.floor(contentBase64.length * 0.75);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return res.status(413).json({ error: `Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` });
      }

      const safeName = filename.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
      const repoPath = `images/${folder}/${Date.now()}-${safeName}`;

      const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURI(repoPath)}`;
      const ghResp = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN.value()}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "BraidsByFobs-Admin"
        },
        body: JSON.stringify({
          message: `Upload ${repoPath} via admin`,
          content: contentBase64,
          branch: GITHUB_BRANCH,
          committer: { name: "Admin Upload", email }
        })
      });

      if (!ghResp.ok) {
        const text = await ghResp.text().catch(() => "");
        console.error("GitHub API error", ghResp.status, text);
        return res.status(502).json({
          error: `GitHub rejected the upload (${ghResp.status}). Check that GITHUB_TOKEN is valid and has write access to ${GITHUB_REPO}.`
        });
      }

      return res.json({ path: repoPath, branch: GITHUB_BRANCH });
    } catch (err) {
      console.error("uploadImage error", err);
      return res.status(500).json({ error: err.message });
    }
  }
);
