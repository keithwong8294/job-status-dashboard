# Job search dashboard

Tracks a job search straight from Gmail: applications, responses, rejections, and job leads
from LinkedIn, Indeed and Glassdoor, counted from May 1, 2026. Sort and filter by job title,
location, pay and responsibilities.

- **Read-only.** The app asks Google for `gmail.readonly`, so it can't send, delete or change mail.
- **No server.** The page talks to Gmail from your browser, and emails are saved only in that browser (IndexedDB).
- **Private per person.** Anyone can use the same page with their own Gmail. Each account's data is kept in its
  own browser database that opens only after that account signs in, so nobody, including the site's owner,
  can see anyone else's email.
- **Live.** While the page is open it checks Gmail every 2 minutes and whenever you switch back to the tab.
  Google ends browser sessions after about an hour, so after that the page asks you to click **Reconnect**.

## How emails are sorted

Rules in [`src/classify.ts`](src/classify.ts) look at the sender and wording:

| Type | Examples of what it looks for |
| --- | --- |
| Rejection | "unfortunately", "move forward with other candidates", "position has been filled" |
| Application | "thank you for applying", "we've received your application", LinkedIn/Indeed "application was sent" |
| Response | "interview", "next steps", "your availability", "phone screen", "offer" |
| Job lead | job alerts from LinkedIn, Indeed and Glassdoor (each listing in the email becomes a row) |

Each application, response and rejection is grouped by company and job title. Title, company,
location and pay are read from the subject and body when they're there. If an email lands in the
wrong bucket, change its type on the **All emails** tab and the dashboard remembers it.

## One-time Google setup (about 5 minutes)

You need your own Google OAuth client ID. It's free, and it's what lets the page ask for Gmail access.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (any name, e.g. "Job Dashboard").
2. Open **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.
3. Open **Google Auth Platform** (formerly "OAuth consent screen") and click **Get started**.
   App name: anything. Support email: yours. Audience: **External**. Contact email: yours. Finish.
4. Under **Audience → Test users**, click **Add users** and add your Gmail address.
5. Under **Clients**, click **Create client**. Type: **Web application**.
   Under **Authorized JavaScript origins**, add `https://keithwong8294.github.io`
   (and `http://localhost:5173` if you'll also run it on your computer). Click **Create**.
6. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and paste it into the dashboard.

Because the app stays in "Testing" mode, Google shows a "Google hasn't verified this app" screen
when you connect. That's expected for a personal app: click **Continue**.

To skip pasting the ID in each new browser, add it as a repository variable named
`GOOGLE_CLIENT_ID` (repo **Settings → Secrets and variables → Actions → Variables**), then re-run
the deploy. Client IDs are not secret.

## Sharing it with other people

Others use the same link and sign in with their own Gmail. Nothing of theirs reaches you or any server.

1. In [Google Cloud Console](https://console.cloud.google.com/) → **Google Auth Platform → Audience → Test users**,
   add each person's Gmail address (up to 100). Google blocks anyone not on this list while the app is in Testing.
2. Set the `GOOGLE_CLIENT_ID` repository variable (above) so they don't need a client ID of their own.
3. Send them the link. They'll see "Google hasn't verified this app" and click **Continue**.

Opening it to anyone without the test-user list needs Google verification. Because `gmail.readonly` is a
restricted scope, that includes a yearly third-party security assessment.

## Using it

Open **https://keithwong8294.github.io/job-status-dashboard/** and click **Connect Gmail**.
Leave the tab open for live updates. Your saved emails stay in that browser between visits,
so later visits only download what's new. Your data appears only after you sign in, and
**Disconnect** offers to delete it, which is worth doing on a shared computer.

Click **Try with sample data** to see the dashboard without connecting Gmail.

## Hosting

Every push to `main` runs the tests, builds, and publishes to GitHub Pages
(the workflow is in `.github/workflows/deploy.yml`). Pages is set to deploy from **GitHub Actions**
under the repo's **Settings → Pages**.

## Running it on your computer

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm run dev     # then open http://localhost:5173
npm test        # email-sorting tests
```

For local runs you can put `VITE_GOOGLE_CLIENT_ID=<your client id>` in a `.env.local` file (ignored by git).

## Drive times

Job leads show a rough drive estimate from the home town set in the resume card. Town locations live in `src/places.json`, built by `scripts/build-places.mjs` from [GeoNames](https://www.geonames.org) (via the `cities.json` npm package, CC BY 4.0) and the `zipcodes` npm package (BSD). Miles are the straight line × 1.3; time assumes 25–55 mph and adds 20 minutes for driving into Manhattan, Brooklyn, Queens or the Bronx.
