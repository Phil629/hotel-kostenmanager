# 🤖 Antigravity Automated Setup Prompt for Other PCs

Copy and paste the following prompt into **Antigravity** on any second PC/laptop to automatically clone, configure, and launch the **Hotel-Kostenmanager** project connected to Supabase Cloud PostgreSQL:

```text
Bitte richte das Projekt Hotel-Kostenmanager von meinem GitHub-Repository auf diesem Rechner ein:

1. Klone das Repository https://github.com/Phil629/hotel-kostenmanager.git in mein Scratch-Verzeichnis.
2. Installiere alle benötigten npm-Abhängigkeiten (npm install).
3. Erstelle die .env-Datei mit den Supabase Cloud PostgreSQL Verbindungsdaten:

DATABASE_URL="postgresql://postgres.gzaeduqugstmipwxjghs:H5cmzEQXgLKp%2A.T@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.gzaeduqugstmipwxjghs:H5cmzEQXgLKp%2A.T@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
APP_PASSWORD="Schottenhof2026!"
NEXT_PUBLIC_SUPABASE_URL="https://gzaeduqugstmipwxjghs.supabase.co"

4. Führe `npx prisma generate` aus.
5. Starte den Entwicklungsserver mit `npm run dev` und verifiziere die Verbindung zu Supabase PostgreSQL.
```
