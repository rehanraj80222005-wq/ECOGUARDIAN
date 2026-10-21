# EcoGuardian

EcoGuardian is a sustainability review prototype built with Next.js,
Supabase, and Google Gemini.

It helps users review utility bills, save electricity activity, explore
demo emissions estimates, and extract reported figures from GHG reports.

**Pre-audit support, not audit certification.**

## Important limitations

- Electricity calculations use a fictional factor of
  **0.5 kg CO₂e per kWh**. Results are not suitable for corporate reporting.
- AI-extracted data is an unverified draft and requires human review.
- File fingerprints identify matching file contents. They do not prove
  authenticity or verify the document's claims.
- Original uploaded files are not stored by the application.
- GHG report extraction results are temporary and disappear on refresh.
- Reported emissions are kept separate from saved electricity estimates.
- The review queue checks missing information, not consumption anomalies.
- Calculations and saving currently support electricity in kWh.
- Source categories are user-selected, not automatically verified.

## Features

### Accounts
- Email signup and confirmation
- Sign-in and sign-out
- Email-code password recovery
- Resend signup confirmation emails
- Account-specific records and sources

### Utility bills
- PDF, JPEG, and PNG uploads up to 3 MiB
- Gemini extraction and manual activity entry
- Reviewable quantities and units
- SHA-256 source registration
- Demo electricity emissions calculation
- Source-linked saving and duplicate-save prevention

### Saved data
- Electricity consumption and demo emissions totals
- Monthly allocation across inclusive billing dates
- Billing-date corrections and correction history
- CSV export
- Source categories: utility bill, GHG report, or unclassified
- Review checks for missing dates, missing source links, and eligible
  sources without saved activity records

### GHG reports
- Local PDF selection up to 20 MiB
- Selection of one to three consecutive pages
- Selected excerpts limited to 3 MiB
- Extraction of reported Scope 1, Scope 2, and Scope 3 figures
- Separate display of location-based and market-based Scope 2 figures

### Copilot and scenarios
- Gemini answers using saved electricity summaries and review counts
- Hypothetical electricity-reduction scenarios
- Shared per-account AI allowance: 5 requests per clock minute and
  30 requests per UTC day

## Technology

- Next.js App Router and TypeScript
- React
- Supabase Auth and PostgreSQL
- Google Gemini through `@google/genai`
- Zod validation
- pdf-lib for selected-page PDF preparation
- Tailwind CSS and custom CSS
- Vercel deployment

Use `package.json` and `package-lock.json` as the dependency references.

## Local setup

From the repository root:

```bash
cd web
npm ci
```

Create `web/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
GEMINI_API_KEY=your_private_gemini_api_key
GEMINI_MODEL=your_supported_gemini_model_id
```

Replace the placeholders with values for your project.

The Supabase URL and publishable key are intended for the browser.
Keep the Gemini API key private and server-side. Never commit `.env.local`
or use a Supabase service-role key in browser code.

Use a Gemini model available to your API project that supports the
document-extraction requests used by this app.

Start development:

```bash
npm run dev
```

Open `http://localhost:3000`, or the forwarded port-3000 URL when using
GitHub Codespaces.

## Database setup

The SQL files are applied manually through the Supabase SQL Editor.
Pushing them to GitHub does not execute them.

For a new, empty database, the intended order is:

1. `supabase/001-emission-records.sql`
2. `supabase/source-documents.sql`
3. `supabase/source-linked-records.sql`
4. `supabase/billing-dates.sql`
5. `supabase/billing-date-corrections.sql`
6. `supabase/restrict-legacy-emission-save.sql`
7. `supabase/restrict-direct-emission-inserts.sql`
8. `supabase/summary.sql`
9. `supabase/monthly-emissions.sql`
10. `supabase/review-summary.sql`
11. `supabase/ai-request-limits.sql`
12. `supabase/source-document-kinds.sql`
13. `supabase/classify-source-documents.sql`
14. `supabase/guard-source-activity-kind.sql`

**Fresh-database setup has not yet been verified end to end.**
Validate this sequence in a separate test project before relying on it.

Several files create tables, columns, or functions without rerun guards.
Do not rerun the entire sequence against an existing populated project.

The classification migration replaces the review-summary function so
sources labelled as GHG reports are excluded from the missing-activity
check. Unclassified sources remain included.

## Authentication configuration

Configure Supabase's Site URL and allowed redirect URLs for the actual
development and deployment domains, including `https://` where applicable.

Signup confirmation and password recovery use different email templates.

The current password-recovery interface expects a code. Its Reset Password
email template must include:

```html
<p>Your EcoGuardian recovery code:</p>
<p><strong>{{ .Token }}</strong></p>
```

The app verifies the code with recovery OTP verification, then displays
the password-setting form.

Email delivery depends on the Supabase project's email configuration.
The default sender has recipient and rate restrictions. Configure a
supported SMTP provider when broader delivery is needed.

Do not change the recovery template to a link-only email without also
updating the application flow.

## Calculation behaviour

The demonstration formula is:

```text
tonnes CO₂e = electricity kWh × 0.5 ÷ 1,000
```

Example:

```text
1,800 kWh × 0.5 ÷ 1,000 = 0.900 tCO₂e
```

Monthly figures allocate consumption and emissions evenly across the
billing period, counting both start and end dates.

Example: 3,100 kWh from 16 September through 16 October 2026 covers 31 days:

- September: 15 days → 1,500 kWh → 0.750 tCO₂e
- October: 16 days → 1,600 kWh → 0.800 tCO₂e

Undated records remain in all-time totals but are excluded from monthly
allocation. Allocation is an estimate, not measured daily consumption.

Different bills can cover overlapping dates; the app does not
automatically resolve overlapping consumption.

## AI usage limits

The copilot, utility-bill extraction, and GHG report extraction share
one allowance per authenticated account:

- 5 accepted requests per clock minute
- 30 accepted requests per UTC day

The daily allowance resets at 00:00 UTC, which is 05:30 in India.

Accepted requests consume allowance even if the provider later fails.
The application's allowance is separate from Gemini's own quotas.
An internal provider retry may create another provider call without
consuming another application request.

These are per-account limits, not a project-wide spending cap.

## Data handling

- Records and registered sources belong to individual accounts.
- Database row-level security and API ownership checks restrict access.
- Emission writes use database functions rather than direct client inserts.
- Original documents are not retained by the application.
- Bill extraction sends the selected file to Gemini.
- Report extraction sends only the selected PDF excerpt to Gemini.
- The copilot receives the question and selected aggregate account context,
  not original files or unsaved report figures.
- Registered metadata, fingerprints, saved activity, and billing-date
  correction history are stored in Supabase.

## Development commands

```bash
npm run dev
npm run lint
npm run build
npm run start
```

`npm run start` runs a previously built production version.

Stop the development server before building in the same checkout, then
restart it for further development.

## Deployment

1. Connect the GitHub repository to Vercel.
2. Set the project Root Directory to `web`.
3. Configure the required environment variables for the intended
   deployment environments.
4. Apply required database migrations separately in Supabase.
5. Configure authentication URLs and email delivery.
6. Build and push the application changes.
7. Check the latest successful deployment.

Changes to environment variables require a new deployment to take effect.
Check the latest deployment or production domain rather than an old
deployment-specific URL.

## Manual checks completed

The following behaviours have been manually tested during development:

- Bill extraction, calculation, and saving
- Duplicate-source save blocking
- Cross-month allocation
- GHG report extraction without changing bill totals
- Daily AI-limit blocking across all three AI routes
- Source classification and review-queue filtering
- Separate account lists and totals
- Rejection of another account's source-details request
- Email-code password recovery, including deployment
- Signup-confirmation resending
- Mobile navigation and layout

These checks are not a comprehensive security audit or an automated
regression suite.

## Remaining work

- Verify setup against a fresh Supabase project
- Add automated regression and authorization tests
- Improve source classification and registration workflows
- Add persistence for reviewed GHG report figures
- Introduce real, versioned emission factors
- Extend supported activity calculations
- Add consumption-anomaly checks
- Add project-wide AI budget controls