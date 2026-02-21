# AI Passport & ID Photo

Browser-based passport photo generator with **local** background removal and A4 print sheet. No API keys, no credits, works offline after setup.

## Architecture

```
Frontend (HTML/JS)  →  Local Node server  →  rembg (Python)  →  Transparent PNG
```

- **Frontend:** Camera/upload, face validation, canvas processing, quantity, print sheet (JPG/PDF).
- **Backend:** Minimal Express server that accepts an image and runs `rembg` locally.
- **Background removal:** Unlimited, free, offline (rembg AI model runs on your machine).

## Setup

### 1. Python + rembg

```bash
pip install rembg
```

Optional (faster on GPU): `pip install rembg[gpu]`

### 2. Node server

```bash
cd server
npm install
npm start
```

Server runs at `http://localhost:3000`. Endpoint: `POST /remove-bg` (multipart/form-data, field `image`).

### 3. Frontend

Open `index.html` in a browser (or use any static server, e.g. `npx serve .` from project root). The app sends background-removal requests to `http://localhost:3000/remove-bg`.

## Usage

1. Start the server: `cd server && npm start`
2. Open the app (e.g. double-click `index.html` or `npx serve .`).
3. Take a photo or upload an image.
4. Click **Apply Background** (uses local rembg).
5. Choose background color (white/gray), set quantity, download print sheet (JPG/PDF).

## Project layout

- `index.html`, `app.js`, `styles.css` — frontend
- `server/` — Node + Express + multer; calls `rembg`; `POST /remove-bg`
- `functions/` — Firebase (optional, unrelated to background removal)

No external background-removal APIs, no proxy, no API keys. All processing is local.

---

## للزبون: رابط واحد يفتح ويشتغل (بدون أي إعداد)

أنت تنشر المشروع **مرة وحدة**، تاخد **رابط واحد**، وتعطيه للزبون. الزبون يفتح الرابط من الموبايل أو الكمبيوتر وكل شي يشتغل.

### خطواتك (مرة وحدة)

1. **انشر على Railway (مجاني):**
   - ادخل [railway.app](https://railway.app) وسجّل دخول بـ GitHub.
   - **New Project** → **Deploy from GitHub repo** → اختر مشروعك.
   - في إعدادات المشروع:
     - **Root Directory:** اتركه فاضي (مجلد الجذر = المشروع كامل).
     - **Dockerfile path:** `server/Dockerfile`
     - أو إذا ما في خيار path: انقل محتويات المشروع بحيث يكون الـ Dockerfile في الجذر، أو استخدم **Render** (تحت).
   - بعد النشر، اضغط على الخدمة وافتح **Settings** → **Generate Domain** أو استخدم الرابط اللي يعطيك إياه Railway.

2. **أو انشر على Render:**
   - ادخل [render.com](https://render.com) → **New** → **Web Service**.
   - وصّل الريبو، ثم:
     - **Root Directory:** اترك فاضي.
     - **Build Command:**  
       `docker build -f server/Dockerfile -t app .`  
     - **Start Command:**  
       `docker run -p 3000:3000 app`  
   - أو: اختر **Docker** كـ environment و **Dockerfile path** = `server/Dockerfile` (والـ build context = جذر المشروع). ثم **Create Web Service**.
   - انسخ الرابط النهائي (مثل `https://passport-id-xxx.onrender.com`).

3. **الرابط اللي يطلع = هو اللي تعطيه للزبون.**  
   الزبون يفتحه من أي جهاز، يرفع صورة أو يلتقط، يضغط "Apply Background"، ويحمّل — بدون أي إعداد أو حسابات أو مفاتيح.

(نفس السيرفر يقدّم الواجهة + إزالة الخلفية من نفس الرابط، فلا تحتاج GitHub Pages ولا config.)

---

## If someone sends you this project

You can run it on your PC:

1. **Install Python** (if not already), then: `pip install rembg`
2. **Install Node.js** (if not already)
3. Open a terminal in the project folder:
   - `cd server`
   - `npm install`
   - `npm start`
4. Open `index.html` in your browser (from the same PC), or run `npx serve .` in the project root and open the URL shown.

Background removal works only when the app and server run on the **same computer**. No account or API key needed.
