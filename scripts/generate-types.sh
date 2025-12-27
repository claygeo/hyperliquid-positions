#!/bin/bash

# Generate Supabase types from database schema

set -e

echo "Generating Supabase types..."

# Generate types using Supabase CLI
npx supabase gen types typescript --project-id cjdrgvbrziahiakxhxsy > apps/web/src/lib/supabase/types.ts

echo "Types generated successfully!"
