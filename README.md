# AI Passport & ID Photo

Browser-only passport photo generator with background removal and A4 print sheet.

## Free 100/day (bgremoverfree.com) on GitHub Pages — Proxy setup

When the app is on **GitHub Pages** (or any static host), the browser blocks direct requests to bgremoverfree.com (CORS). Use a **proxy** so the server calls the API — no CORS, no paid plan required.

| Option | Cost | Who calls the API? |
|--------|------|--------------------|
| **Vercel** (recommended) | Free | Server (proxy) |
| Firebase Functions | Blaze required | Server (proxy) |

---

### Option 1: Vercel proxy (free, no upgrade)

1. Install Vercel CLI (one time): `npm i -g vercel`
2. From the project root: `vercel` and follow the prompts (log in if needed).
3. Copy the deployed URL (e.g. `https://id-xxx.vercel.app`). The proxy is at:  
   **`https://your-project.vercel.app/api/bgremoverfree-proxy`**
4. In the app, choose **Free 100/day (bgremoverfree.com)** and set **Proxy URL** to that URL.
5. (Optional) Connect your Git repo in the Vercel dashboard so every push deploys automatically.

The proxy lives in `api/bgremoverfree-proxy.js` and forwards your request to bgremoverfree.com with your API key; it does not store the key.

---

### Option 2: Firebase Functions (requires Blaze)

If you prefer Firebase and are okay with the [Blaze (pay-as-you-go)](https://console.firebase.google.com/project/passport-id-johnycreator/usage/details) plan (you only pay if you exceed the free tier):

1. Install Firebase CLI: `npm install -g firebase-tools`
2. Log in and select project: `firebase login` then `firebase use passport-id-johnycreator`
3. Install and deploy:
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
4. Use the function URL as **Proxy URL** in the app (e.g. the app can auto-fill from `firebase-config.js` if the project ID matches).

---

### Using the app

- **Recommended (avoids "Blocked" on mobile):** Open the app from your **Vercel URL** (e.g. `https://id-azure-one.vercel.app`). The proxy is then same-origin and no extra setup is needed — just add your bgremoverfree API key.
- On GitHub Pages: set **Proxy URL** to your Vercel proxy; if background removal is blocked (e.g. "Load failed"), use the app from the Vercel URL instead.

### If it still doesn't work

1. **Test the proxy:** Open `https://id-azure-one.vercel.app/api/bgremoverfree-proxy` in the browser. You should see `{"ok":true,"message":"bgremoverfree proxy is running",...}`. If you get 404 or an error, redeploy: from project root run `vercel --prod`.
2. **Use the app only from Vercel:** Always open `https://id-azure-one.vercel.app` (not GitHub Pages). Take/upload photo, enter **bgremoverfree.com API Key**, click Apply Background. Leave Proxy URL as-is (it fills automatically).
3. **Check the API key:** Get a free key from [bgremoverfree.com](https://bgremoverfree.com). If you hit "401" or "invalid", the key is wrong or expired.
4. **Studio fallback:** If Free still fails, switch to **Studio (remove.bg)** in the dropdown and add your remove.bg API key — it works from any host.
