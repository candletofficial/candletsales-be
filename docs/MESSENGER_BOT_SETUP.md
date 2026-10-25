# Candlet Messenger AI bot

The bot receives Facebook Page messages directly from Meta, uses the OpenAI Responses API for product consultation, and creates an order draft only after the customer confirms a complete order.

## Required environment variables

Configure these values locally in `.env` and again in the Render service environment. Never add real secrets to Git.

```env
OPENAI_API_KEY=
OPENAI_SALES_MODEL=gpt-5.4-mini
META_PAGE_ACCESS_TOKEN=
META_VERIFY_TOKEN=
META_APP_SECRET=
META_GRAPH_VERSION=v24.0
```

`META_VERIFY_TOKEN` is a private random value that you choose. It is entered in both Render and the Meta webhook setup screen.

## Meta setup

1. Open Meta for Developers and create or select a Business app.
2. Add the Messenger product and connect the Candlet Facebook Page.
3. Generate a Page Access Token for that Page.
4. Set the webhook callback to:

   `https://<render-backend-domain>/api/webhooks/meta`

5. Enter the same `META_VERIFY_TOKEN` used by the backend.
6. Subscribe the Page to message and postback events.
7. Add the app secret and Page token to Render, then redeploy.
8. Complete the Meta permissions/app review required before serving customers who are not app testers.

## Admin workflow

Open `/admin/messenger-bot` to:

- see whether OpenAI and Meta credentials are configured;
- review conversations handed to a person;
- pause or resume bot replies per conversation;
- approve or reject Messenger order drafts.

Approving a draft creates a tracked Facebook order, validates materials through the existing order workflow, deducts inventory, and sends the customer their order number and public tracking link.

## Operating rules

- The bot never creates a real order before explicit customer confirmation and admin approval.
- Complaints, refunds, transfer receipts, medical questions, and requests for a person are handed off.
- Duplicate Meta message IDs are ignored for 30 days.
- OpenAI receives the current product catalog and recent conversation context. API requests use `store: false`.
- A free Render instance can cold-start. Watch Meta webhook delivery logs during rollout and use an always-on receiver before relying on the bot for paid ad traffic.
