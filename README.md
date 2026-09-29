# BSE Company Result Calendar — Angular

Angular viewer for the BSE Corporate Forthcoming Results API.

## BSE API

The backend calls:

`https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w`

with:

`fromdate=YYYYMMDD&todate=YYYYMMDD`

The API normalizes BSE fields such as `scrip_Code`, `short_name`, `Long_Name`, `meeting_date`, and `URL` for the Angular UI. Results are sorted by meeting date and only dates from the present Indian date onward are shown.

## Telegram alerts

GitHub Actions checks every 30 minutes. It compares the current BSE result calendar against `data/bse-result-state.json`.

- First run: creates a baseline and sends no alerts.
- Later runs: sends a Telegram message only for newly detected company/date events.
- The state is committed back to the repository.

Add these GitHub repository secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Workflow: `.github/workflows/bse-result-alert.yml`

## Run on Windows

```cmd
npm install
npm start
```

Open `http://localhost:4200`.

## Test

```cmd
npm test
```

The included test uses the supplied BSE result-calendar JSON as a fixture and also runs the local API end-to-end against a local mock BSE server. Real BSE HTTP and Telegram delivery require external network access and configured Telegram secrets.

## API

`GET /api/event-calendar?from_date=2026-09-29&to_date=2026-12-29`

If the requested start date is before today, the server clamps it to today's Indian date.
