# How to gather your Azure PostgreSQL credentials

Fill in `azure-pg-credentials.json` with the values below. That file is
**git-ignored** so your real password never gets committed.

---

## Part 1 — Find your server & get each value

### Option A — Azure Portal (click-through)

1. Go to **https://portal.azure.com** and sign in.
2. In the top search bar, type **"Azure Database for PostgreSQL"** and open it.
   You'll see your server(s) listed. Note whether it's a **Flexible Server**
   or a **Single Server** — this changes the username format.
3. Click your server, then read off the **Overview** blade:
   - **AZURE_PG_HOST** = the **Server name** / **Host name**
     (looks like `my-server.postgres.database.azure.com`).
   - **AZURE_PG_USER** = the **Admin username**.
     - Flexible Server → use it as-is, e.g. `myadmin`.
     - Single Server → append the server, e.g. `myadmin@my-server`.
   - **AZURE_PG_PORT** = `5432` (default; shown under Connection details).
4. **AZURE_PG_DATABASE** = the database *inside* the server (not the server
   name). Under **Settings → Databases** you'll see the list. A brand-new
   Flexible Server has one called `postgres`; use that unless you created a
   dedicated one.
5. **AZURE_PG_PASSWORD** = the admin password you set when the server was
   created. If you don't have it, reset it under
   **Overview → Reset password** (or Settings → Authentication).
6. **AZURE_PG_SSL** = leave as `require`.

### Option B — Azure CLI (I can pull most of this for you)

Once you're logged in (`az login`), these fill in most fields automatically:

```bash
# List all Postgres Flexible Servers (host, user, version, state)
az postgres flexible-server list \
  --query "[].{name:name, host:fullyQualifiedDomainName, admin:administratorLogin, state:state, rg:resourceGroup}" \
  -o table

# List Single Servers (older SKU), if any
az postgres server list \
  --query "[].{name:name, host:fullyQualifiedDomainName, admin:administratorLogin}" \
  -o table

# List databases inside a given flexible server
az postgres flexible-server db list \
  --server-name <SERVER_NAME> --resource-group EnterpriseDS_ResourceGRP -o table
```

- `host` → **AZURE_PG_HOST**
- `admin` → **AZURE_PG_USER** (Flexible = as-is; Single = `admin@name`)
- a db name → **AZURE_PG_DATABASE**
- Port stays `5432`, SSL stays `require`.
- The **password is never retrievable** via CLI — you must know it or reset it.

---

## Part 2 — Prepare the server so the connection actually works

1. **Firewall / Networking**
   - Portal → your server → **Settings → Networking** (Flexible) or
     **Connection security** (Single) → **Firewall rules**.
   - Add the Lovable runtime egress IPs (I'll pull the current list when we're
     ready). To start quickly you can enable **"Allow public access from any
     Azure service…"** or add a wide range, then tighten later.
   - CLI equivalent (single IP example):
     ```bash
     az postgres flexible-server firewall-rule create \
       --name <SERVER_NAME> --resource-group EnterpriseDS_ResourceGRP \
       --rule-name lovable --start-ip-address <IP> --end-ip-address <IP>
     ```

2. **Enable the VECTOR extension in server parameters**
   - Portal → your server → **Settings → Server parameters** → search
     **`azure.extensions`** → make sure **VECTOR** is checked (also **PG_TRGM**
     if you want fuzzy fact matching) → **Save** (may restart the server).
   - CLI equivalent:
     ```bash
     az postgres flexible-server parameter set \
       --server-name <SERVER_NAME> --resource-group EnterpriseDS_ResourceGRP \
       --name azure.extensions --value VECTOR,PG_TRGM
     ```

3. **Create the extension in the target database (run once)**
   - Connect with `psql` (or the portal's query tool) to your database and run:
     ```sql
     CREATE EXTENSION IF NOT EXISTS vector;
     ```
   - psql example:
     ```bash
     psql "host=<HOST> port=5432 dbname=<DB> user=<USER> password=<PW> sslmode=require" \
       -c "CREATE EXTENSION IF NOT EXISTS vector;"
     ```

---

## Part 3 — (Alternative) single connection string

If you'd rather not juggle 6 fields, put ONE value in the
`_alternative_single_secret.DATABASE_URL` slot instead:

```
postgresql://<user>:<password>@<host>:5432/<database>?sslmode=require
```

That single secret replaces all six `AZURE_PG_*` fields.

---

## Reminder
- `azure-pg-credentials.json` is git-ignored — keep it that way.
- Prefer storing these as **secrets** in your host (GitHub / Lovable), not in
  plaintext files, once you've captured them.
