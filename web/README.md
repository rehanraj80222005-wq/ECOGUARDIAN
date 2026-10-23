# EcoGuardian

EcoGuardian is a sustainability review prototype built with Next.js,
Supabase, and Google Gemini.

It helps users review utility bills, save electricity activity, explore
demo emissions estimates, and review, save, and export reported GHG figures.

**Pre-audit support, not audit certification.**

## Important limitations

- Electricity calculations use a fictional factor of
  **0.5 kg CO₂e per kWh**. Results are not suitable for corporate reporting.
- AI-extracted data is an unverified draft and requires human review.
- User review does not constitute independent verification.
- File fingerprints identify file contents; they do not prove authenticity.
- Original uploaded files are not stored by the application.
- Unsaved extraction drafts disappear on refresh.
- Saved GHG report snapshots persist in the user's account.
- Reported GHG figures remain separate from calculated electricity totals.
- Alternative Scope 2 accounting bases must not be added together.
- The review queue checks missing information, not consumption anomalies.
- Activity calculations and saving currently support electricity in kWh.
- Source categories are user-selected, not automatically verified.

## Features

### Accounts

- Email signup and confirmation
- Sign-in and sign-out
- Email-code password recovery
- Resend signup confirmation emails
- Account-specific activity, sources, and saved GHG reports

### Utility bills

- PDF, JPEG, and PNG uploads up to 3 MiB
- Gemini extraction and manual activity entry
- Reviewable quantities and units
- SHA-256 source registration
- Demo electricity emissions calculation
- Source-linked saving and duplicate-save prevention

### Electricity records and summaries

- Electricity consumption and demo emissions totals
- Monthly allocation across inclusive billing dates
- Billing-date corrections and correction history
- Activity CSV export
- Source categories: utility bill, GHG report, or unclassified
- Review checks for missing dates, missing source links, and eligible
  sources without saved activity records
- Guards preventing GHG-report sources from receiving electricity activity

### GHG reports

- Local PDF selection up to 20 MiB and 500 pages
- Extraction from one to three consecutive pages
- Selected PDF excerpts limited to 3 MiB
- Reported Scope 1, Scope 2, and Scope 3 figures
- Separate location-based and market-based Scope 2 figures
- Editable fields, evidence quotations, and source page references
- Removal of unwanted figures before saving
- Explicit user-review confirmation
- Persistent reviewed snapshots, with the latest 10 displayed
- Original filename, file size, and SHA-256 identification
- CSV download with one row per figure

Reported values remain text to preserve entries such as `1,250.0`
or `<0.1`. No demonstration emission factor is applied to these figures.

A submitted snapshot is locked in the current form. Retries reuse its
save ID. This prevents duplicate insertion for the same save ID; it does
not prevent separately saving the same report with a new ID.

Saved snapshots do not currently support editing or deletion through
the interface.

CSV exports retain evidence, accounting bases, warnings, and page references.
Spreadsheet-sensitive text is prefixed with an apostrophe to reduce formula
interpretation risks.

### Copilot and scenarios

- Gemini answers using saved electricity summaries and review counts
- Hypothetical electricity-reduction scenarios
- Shared per-account AI allowance: 5 requests per clock minute and
  30 requests per UTC day

Saved GHG reports are not included in electricity totals or the copilot's
existing electricity-summary context.

## Technology

- Next.js App Router and TypeScript
- React
- Supabase Auth and PostgreSQL
- Google Gemini through `@google/genai`
- Zod validation
- pdf-lib for selected-page PDF preparation
- Tailwind CSS and custom CSS
- Vitest for API route tests
- GitHub Actions for automated checks
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

Replace the placeholders with project-specific values.

The Supabase URL and publishable key are intended for the browser.
Keep the Gemini API key private and server-side. Never commit `.env.local`
or use a Supabase service-role key in browser code.

Choose a Gemini model available to your API project that supports
the document-extraction requests used by this app.

Start development:

```bash
npm run dev
```

Open localhost on port 3000, or the forwarded port-3000 URL in Codespaces.

## Database setup

Apply the SQL files through the Supabase SQL Editor.
Pushing them to GitHub does not execute them against hosted Supabase.

For a new, empty database, apply these files in order.
Paths below are relative to the `web` directory:

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
15. `supabase/saved-ghg-reports.sql`

These files are not generally safe to rerun unchanged. For an existing
database, apply only migrations that have not already been applied.

Files under `supabase/tests/` are isolated test fixtures, not production
migrations. Do not run them in the production SQL Editor.

All 15 migrations passed an ordered clean-install check on PostgreSQL 17
with a minimal simulated Supabase Auth schema. Hosted Supabase functionality
has also been tested during development.

A complete fresh Supabase-stack installation has not yet been verified.
The isolated PostgreSQL check does not test Auth email delivery, Storage,
Realtime, or the full hosted API stack.

## Authentication configuration

Configure Supabase's Site URL and allowed redirect URLs for the actual
development and production domains, including the appropriate URL scheme.

Signup confirmation and password recovery use different email templates.

The current password-recovery interface expects a code. Its Reset Password
email template must include:

```html
<p>Your EcoGuardian recovery code:</p>
<p><strong>{{ .Token }}</strong></p>
```

The app verifies the recovery code, then displays the password-setting form.

Email delivery depends on the Supabase project's sender configuration.
Do not switch to a link-only recovery email without updating the app flow.

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

For 3,100 kWh from 16 September through 16 October 2026:

- September: 15 days → 1,500 kWh → 0.750 tCO₂e
- October: 16 days → 1,600 kWh → 0.800 tCO₂e

The monthly view covers 12 months ending with the latest dated bill's
end month. An account without dated records has no monthly series.

Undated records remain in all-time totals but are excluded from monthly
allocation. Allocation is an estimate, not measured daily consumption.

Different bills may overlap. The app does not automatically resolve
overlapping consumption.

## AI usage limits

Copilot, utility-bill extraction, and GHG report extraction share
one allowance per authenticated account:

- 5 accepted requests per clock minute
- 30 accepted requests per UTC day

The daily allowance resets at 00:00 UTC, which is 05:30 in India.

Accepted requests consume allowance even if the provider later fails.
The application allowance is separate from Gemini's own quotas.
An internal provider retry may create another provider call without
consuming another application request.

Reviewing, saving, reopening, and exporting a GHG snapshot do not call Gemini.

These are per-account limits, not a project-wide spending cap.

## Data handling

- Activity, source registrations, and saved GHG reports belong to accounts.
- Database row-level security and API ownership checks restrict access.
- Electricity writes use protected database functions.
- GHG snapshots use a separate table with owner-based access policies.
- GHG snapshot APIs validate fields; database constraints enforce basic
  snapshot structure and size.
- Original documents are not retained by the application.
- Bill extraction sends the selected file to Gemini.
- Report extraction sends only the selected PDF excerpt to Gemini.
- Saving a GHG snapshot sends reviewed data and file identification,
  not the original PDF.
- Copilot receives the question and selected aggregate account context.
- Supabase stores source metadata, fingerprints, electricity activity,
  billing-date history, and saved GHG snapshots.
- GHG CSV downloads are generated in the browser from the loaded snapshot.

## Development commands

Run application commands from `web`:

```bash
npm run dev
npm run lint
npm test
npm run build
npm run start
```

`npm run start` runs a previously built production version.

Stop the development server before building in the same checkout,
then restart it for further development.

Run database checks from `web` with Docker available:

```bash
bash scripts/check-migrations.sh
```

The script creates a temporary PostgreSQL container, applies migrations,
runs database tests, and removes the container. It does not connect to
hosted Supabase.

## Automated checks

### Application checks

GitHub Actions installs locked dependencies, runs Vitest, and builds the app.

The current 44 API tests cover calculation and reviewed electricity saving,
including validation, authentication rejection, and database error handling.

Authentication and database responses are mocked in those route tests.
They do not independently verify real authentication or database policies.

### Database checks

The database workflow runs all 15 migrations and tests:

- Dated electricity saves and demo conversion
- Duplicate-save rejection
- GHG category guards
- Cross-account source and activity isolation
- Monthly allocation, leap years, empty months, and totals
- Monthly account isolation
- AI minute and daily limits
- Counter resets, account isolation, and restricted counter access

Quota tests exercise sequential requests, not concurrent requests.

The GHG snapshot API, editor, saved-report display, and CSV export have
been manually checked; dedicated automated coverage remains to be added.

## Deployment

1. Connect the GitHub repository to Vercel.
2. Set the project Root Directory to `web`.
3. Configure environment variables for the intended environments.
4. Apply required migrations separately to the Supabase project used by Vercel.
5. Configure authentication URLs and email delivery.
6. Commit and push application changes.
7. Check GitHub Actions and the matching Vercel production deployment.

GitHub's green checks confirm automated checks passed.
Vercel's Ready status confirms a deployment completed.

With the existing Git integration, pushing to `main` triggers deployment.
Changes to environment variables require a new deployment.

Use the production domain or matching latest deployment rather than an
older deployment-specific URL.

## Manual verification

Development checks have covered:

- Bill extraction, calculation, and saving
- Duplicate-source blocking
- Cross-month allocation
- GHG extraction without changing electricity totals
- Shared daily AI-limit blocking across the AI routes
- Source classification and review-queue filtering
- Account-specific lists and totals
- Rejection of another account's source-details request
- Email-code password recovery
- Signup-confirmation resending
- Mobile navigation and layout
- GHG editing, review confirmation, and saving
- Saved GHG reports remaining available after refresh
- Saved GHG reports hidden from a second account
- Saved GHG reports displayed in production
- GHG CSV downloads working in production

These checks and automated tests are not a comprehensive security audit.

## Remaining work

- Verify a complete fresh Supabase setup
- Add automated GHG snapshot API, authorization, and export tests
- Improve recovery after an uncertain report-save response
- Add pagination beyond the latest 10 saved GHG snapshots
- Design report correction, revision, and deletion workflows
- Improve source classification and registration workflows
- Introduce real, versioned emission factors
- Extend supported activity calculations
- Add consumption-anomaly checks
- Add project-wide AI budget controls
- Test concurrent quota and save requests