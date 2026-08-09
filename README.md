# Queueless

Queueless now includes a shared customer ordering flow and business dashboard backed by a local SQLite database. The database is created automatically the first time the server starts.

## Run locally

This project needs Node.js 24 or later because it uses Node's built-in SQLite module.

```powershell
npm start
```

Then open [http://localhost:3000/queless.html](http://localhost:3000/queless.html). Do not open the HTML files directly: the server provides the database and API connection.

## Demo business account

| Field | Value |
| --- | --- |
| Business | Bean & Bloom, Colombo 07 |
| Email | `owner@beanandbloom.lk` |
| Password | `BeanBloom!2026` |
| Business login | [http://localhost:3000/business-portal/index.html](http://localhost:3000/business-portal/index.html) |

## Test the shared workflow

1. Open the customer order page and select **Bean & Bloom · Colombo 07**.
2. Enter a name, phone number, and order, then submit it.
3. Sign in to the business portal with the demo account. The new order appears in **Incoming orders** within 10 seconds.
4. Accept, fulfil, or cancel the order. The customer queue page automatically reflects the updated status within 10 seconds.

The SQLite file is stored at `data/queueless.db` and is intentionally ignored by Git so local customer information is not committed. For a public deployment, host this Node server behind HTTPS and set `NODE_ENV=production` to send secure session cookies.
