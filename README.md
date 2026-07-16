# JR Fine Wood LLC — website

Static marketing site for JR Fine Wood LLC (bespoke furniture & joinery), built from the
uploaded design draft (`Website_design_request.zip`) and finished for deployment.

## Pages

| File | Page |
|---|---|
| `index.html` | Home — hero, services overview, featured work, Instagram, about, CTA |
| `work.html` | Portfolio gallery |
| `services.html` | Services + commission process |
| `contact.html` | Contact details + enquiry form |

Shared assets live in `css/site.css`, `js/site.js` and `assets/` (logos).

## What "finished" means here

- Converted from the design-tool export (`.dc.html` + React runtime) to plain, dependency-free HTML/CSS/JS.
- Proper `<head>` on every page: titles, meta descriptions, Open Graph tags, favicon.
- Fully responsive: mobile nav with hamburger menu, fluid type via `clamp()`, all grids collapse cleanly; respects `prefers-reduced-motion`.
- Contact form works: validates name/email/piece, then composes a pre-filled email to `hello@jrfinewood.com` (no backend required).
- Editor notes ("DROP INSTAGRAM PHOTO" etc.) removed; photo slots are styled placeholder tiles with captions.

## Still to do (needs the client)

- **Photos** — every `.ph` element is a placeholder tile. Replace with real photos from
  [@00_jr_wood](https://www.instagram.com/00_jr_wood), e.g.
  `<div class="ph tile g-lg" style="background:url('assets/work/table.jpg') center/cover;">`.
- **Form backend (optional)** — the form currently opens the visitor's email app. For silent
  submission, point it at a service like Formspree and remove the `mailto:` handler in `js/site.js`.
- Confirm the stats (18 years, 400+ pieces) and testimonial copy with the owner.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

No build step. Deployable as-is to GitHub Pages, Netlify, or any static host.
