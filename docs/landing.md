# Landing page

The page a visitor **without a session** sees at `/`. It explains what orgtable is and
offers the two ways to use it: a free account on this instance, or installing it on
their own server with one command.

![The landing page in the light theme](./screenshots/landing-light.webp)

<details>
<summary>On a phone, dark theme</summary>

<img src="./screenshots/landing-mobile-dark.webp" alt="The landing page on a 390 px wide phone in the dark theme" width="320">

</details>

## When it shows

`/` sends everyone where they belong, in this order (`app/page.tsx`):

1. Instance not set up yet → `/setup`.
2. Signed in → `/boards`.
3. Otherwise, `ORGTABLE_LANDING` decides between the landing and `/login`:

| `ORGTABLE_LANDING`         | Landing at `/`                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `auto` (default, or empty) | Only while sign-up is open (_Admin › Instance_). A private instance keeps going straight to the sign-in screen, as before.           |
| `on`                       | Always. With sign-up closed it does not promise a free account: it says sign-up is paused and links to sign-in and to the installer. |
| `off`                      | Never: `/` redirects to `/login`.                                                                                                    |

Any other value stops the page with an error that names the variable, instead of
silently picking one.

`proxy.ts` lets `/` through without a session (exactly `/`, not its subpaths: every
private route still redirects to `/login`), and `robots.txt` allows `/$` when sign-up is
open.

## What it offers

- **Free online.** "Create a free account" links to `/register`. It only appears while
  sign-up is open; it is the same switch that opens `/register`.
- **Self-hosted.** The install command, built from `ORGTABLE_INSTALL_URL`:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/Aimarmndz/orgtable/main/install.sh | bash
  ```

  A fork that publishes its own installer points `ORGTABLE_INSTALL_URL` at it. The URL
  must be `https` (visitors pipe it into a shell) and may not contain characters a shell
  would interpret (`; | & $` quotes, spaces); otherwise the page fails with the reason.
  Next to the command there are links to the script itself, to read it before running
  it, and to [self-hosting.md](./self-hosting.md) in the instance's source repository
  (`ORGTABLE_SOURCE_URL`).

  The command only works while the repository is public: `raw.githubusercontent.com`
  answers 404 for a private one.

The footer is the same as on every public page: legal pages, source code, license,
attribution (LICENSE, section 7(b)) and the language picker.

## Design

Retro, over the app's own palette: see DESIGN.md, "Landing". The texts are in
`locales/<code>/landing.json`; the example board uses the real board and label colours
(`app/lib/colors.ts`).

Files:

- `app/page.tsx`: when it shows.
- `app/lib/landing.ts`: `ORGTABLE_LANDING`, `ORGTABLE_INSTALL_URL` and the command.
- `app/components/landing/`: the page, its fonts and the copy button (the only client
  code).
- `app/globals.css`, "Landing" section: the retro classes and tokens.
- `test/landing.test.ts`: configuration, routing, the closed sign-up case, a fork's
  installer, the footer and the language.
