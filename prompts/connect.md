# Connect to Seed Network

Help the user connect their Seed Network account.

If the user provided a token (starts with `sn_`), use the `seed_connect` command: `/seed-connect <token>`

If no token was provided, explain:
1. Go to your Seed Network account at beta.seedclub.com
2. Navigate to Admin → API Tokens
3. Generate a new token
4. Run `/seed-connect <token>` with the generated token

You can check the current connection status with `seed_auth_status`.
