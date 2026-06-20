# ComicBook — Interactive Flipbook Viewer

An interactive comic-book reader built with pure HTML, CSS, and JavaScript. It uses the [StPageFlip](https://github.com/Nodlik/StPageFlip) library to render a realistic page-turn animation and runs entirely as a static website — no server-side code required.

---

## Features

- Realistic 3-D page-flip animation with shadow
- Double-page spread layout (cover + interior pages + back cover)
- Navigation via Previous / Next buttons and keyboard arrow keys
- Jump-to-page panel with page number dots
- Storyteller mode — magnifier lens for zooming in on panels
- Auto-opens on load with a cover sweep animation
- Responsive sizing — adapts to any viewport on resize
- Logo backdrop revealed as the cover sweeps open
- IIS-ready `web.config` with correct MIME types and cache headers

---

## Project Structure

```
ComicBook/
├── index.html              # Main page
├── web.config              # IIS configuration (MIME types, cache, default doc)
├── css/
│   └── style.css           # All styling
├── js/
│   └── main.js             # App logic (StPageFlip init, navigation, storyteller)
├── lib/
│   └── page-flip.browser.js  # StPageFlip library (bundled, no CDN needed)
└── images/
    ├── logo.jpg            # Logo shown on the left half behind the cover
    ├── cover.png           # Front cover
    ├── page-01.png         # Interior pages (page-01 through page-08)
    ├── ...
    └── back-cover.jpg      # Back cover
```

---

## Replacing Pages / Images

To swap in your own comic pages:

1. Export each page as a PNG or JPG at the same width and height.
2. Name them `cover.png`, `page-01.png`, `page-02.png` … `back-cover.jpg` and drop them into `images/`.
3. If you add or remove interior pages, add or remove the corresponding `<div class="page">` entries inside `<div id="book">` in `index.html`.

The viewer auto-detects the aspect ratio from `page-01.png` at runtime, so no code change is needed when the image dimensions change.

---

## Hosting on IIS (Windows Server / IIS 8.5+)

### Prerequisites

- Windows Server with IIS installed, **or** Windows 10/11 with IIS enabled via *Turn Windows features on or off*
- IIS Management Console (`inetmgr`) access

---

### Step 1 — Enable IIS (if not already installed)

**Windows Server:**
1. Open **Server Manager** → *Add Roles and Features*.
2. Select **Web Server (IIS)** and complete the wizard with default options.
3. Click **Install**.

**Windows 10/11:**
1. Open *Control Panel* → *Programs* → *Turn Windows features on or off*.
2. Check **Internet Information Services** and expand to ensure **World Wide Web Services** and **IIS Management Console** are ticked.
3. Click **OK** and wait for the installation to finish.

---

### Step 2 — Copy the site files to the server

Copy the entire project folder to a directory on the server, for example:

```
C:\inetpub\wwwroot\ComicBook\
```

Make sure the folder contains:
```
C:\inetpub\wwwroot\ComicBook\
    index.html
    web.config
    css\
    js\
    lib\
    images\
```

---

### Step 3 — Create a new IIS website (or virtual application)

#### Option A — New dedicated website

1. Open **IIS Manager** (`inetmgr`).
2. In the left panel, expand the server node and right-click **Sites** → *Add Website…*
3. Fill in the dialog:
   - **Site name:** `ComicBook`
   - **Physical path:** `C:\inetpub\wwwroot\ComicBook`
   - **Binding — Type:** `http` (or `https` if you have a certificate)
   - **Port:** `8080` (or any free port; use `80` if no other site uses it)
4. Click **OK**.

#### Option B — Virtual application under the Default Web Site

1. In IIS Manager, expand **Sites** → **Default Web Site**.
2. Right-click **Default Web Site** → *Add Application…*
3. Set:
   - **Alias:** `ComicBook`
   - **Physical path:** `C:\inetpub\wwwroot\ComicBook`
4. Click **OK**.

The app will be reachable at `http://<server>/ComicBook/`.

---

### Step 4 — Set folder permissions

IIS runs under the **IIS_IUSRS** identity, which must be able to read the files.

1. Right-click the `ComicBook` folder in Windows Explorer → *Properties* → *Security* tab.
2. Click **Edit** → **Add…**
3. Type `IIS_IUSRS` → *Check Names* → **OK**.
4. Grant **Read & Execute**, **List folder contents**, and **Read** permissions.
5. Click **OK** / **Apply**.

---

### Step 5 — Verify the web.config is in place

The included `web.config` handles:
- Correct MIME types for `.js`, `.css`, `.png`, `.jpg`, `.svg`, `.woff`, `.woff2`
- `Cache-Control` and `X-Content-Type-Options` response headers
- `index.html` as the default document

IIS reads this file automatically — no manual MIME-type configuration is needed in IIS Manager.

---

### Step 6 — Browse the site

Open a browser and navigate to:

- **Dedicated site:** `http://localhost:8080` (or whatever port you chose in Step 3A)
- **Virtual app:** `http://localhost/ComicBook/`

You should see the comic open with the cover sweep animation.

---

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Blank page / 403 Forbidden | Folder permissions | Re-check Step 4 |
| JS or CSS returns 404 | MIME types not registered | Confirm `web.config` is in the site root |
| Images missing | Wrong physical path | Verify the path in IIS Manager matches the folder |
| Port already in use | Another site on the same port | Change the binding port in Step 3A |
| Changes not reflected | Browser cache | Hard-refresh with `Ctrl + Shift + R` |

---

## Browser Support

Works in all modern browsers (Chrome, Edge, Firefox, Safari). Requires JavaScript enabled. No external dependencies or CDN calls — everything is bundled locally.

---

## License

This project is for private use. The bundled `page-flip.browser.js` is distributed under the [MIT License](https://github.com/Nodlik/StPageFlip/blob/master/LICENSE).
