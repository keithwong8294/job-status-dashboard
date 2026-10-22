# Job search dashboard

Tracks a job search straight from Gmail: applications, responses, rejections, and job leads
from LinkedIn, Indeed and Glassdoor, counted from May 1, 2026. Sort and filter by job title,
location, pay and responsibilities.

- **Read-only.** The app asks Google for `gmail.readonly`, so it can't send, delete or change mail.
- **No server.** The page talks to Gmail from your browser, and emails are saved only in that browser (IndexedDB).
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
   Under **Authorized JavaScript origins**, add `http://localhost:5173`. Click **Create**.
6. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and paste it into the dashboard.

Because the app stays in "Testing" mode, Google shows a "Google hasn't verified this app" screen
when you connect. That's expected for a personal app: click **Continue**.

To skip pasting the ID in a new browser, create a file named `.env.local` in this folder containing
`VITE_GOOGLE_CLIENT_ID=<your client id>`. It's ignored by git.

## Running it

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
git clone https://github.com/keithwong8294/job-status-dashboard.git
cd job-status-dashboard
npm install
npm run dev     # then open http://localhost:5173
```

Leave the page open in a tab for live updates. Your saved emails stay in that browser between runs,
so later visits only download what's new. `npm test` runs the email-sorting tests.

Click **Try with sample data** to see the dashboard without connecting Gmail.
