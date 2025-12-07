#!/bin/bash
set -e

# This script creates the notesapp role with password from environment variable
# It runs BEFORE init.sql (because 00- prefix comes before init.sql alphabetically)
# This way we only store the password in .env, not in SQL files

echo "Creating notesapp role with password from environment..."

# Extract the password from DATABASE_URL environment variable
# DATABASE_URL format: postgresql://notesapp:PASSWORD@postgres:5432/notesdb
NOTESAPP_PASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/notesapp:\([^@]*\)@.*/\1/p')

if [ -z "$NOTESAPP_PASSWORD" ]; then
    echo "ERROR: Could not extract notesapp password from DATABASE_URL"
    exit 1
fi

# Create the role with the password from environment
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Drop and recreate to ensure clean state
    DROP ROLE IF EXISTS notesapp;
    CREATE ROLE notesapp WITH LOGIN PASSWORD '$NOTESAPP_PASSWORD';

    -- Note: notesapp is created WITHOUT SUPERUSER and WITHOUT BYPASSRLS
    -- This ensures RLS policies are enforced for the application
EOSQL

echo "✓ notesapp role created successfully with password from DATABASE_URL"
