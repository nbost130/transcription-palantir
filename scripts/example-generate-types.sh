#!/bin/bash
#
# Example Type Generation Script
# 
# This script demonstrates how to generate TypeScript types from the
# Transcription Palantir OpenAPI specification.
#
# Consumer repos (mithrandir-unified-api, mithrandir-admin) should add
# a similar script to their package.json.

set -e

# Configuration
API_URL="${API_URL:-http://palantir.tailnet:3001}"
OUTPUT_FILE="${OUTPUT_FILE:-./types/palantir.d.ts}"

echo "🔮 Generating TypeScript types from Transcription Palantir API..."
echo "API URL: $API_URL/documentation/json"
echo "Output: $OUTPUT_FILE"
echo ""

# Check if API is reachable
if ! curl -sf "$API_URL/documentation/json" > /dev/null; then
  echo "❌ Error: Cannot reach API at $API_URL"
  echo "   Make sure the Transcription Palantir API is running."
  echo ""
  echo "   Try: curl $API_URL/documentation/json"
  exit 1
fi

# Generate types
echo "Generating types..."
npx openapi-typescript "$API_URL/documentation/json" -o "$OUTPUT_FILE"

echo ""
echo "✅ Types generated successfully!"
echo "   File: $OUTPUT_FILE"
echo ""
echo "Next steps:"
echo "  1. Review the generated types"
echo "  2. Run 'npm run type-check' to verify compilation"
echo "  3. Commit the generated file to version control"
echo ""
echo "Usage in your code:"
echo "  import type { paths, components } from './types/palantir';"
echo "  // Note: TypeScript imports don't include the .d.ts extension"
echo ""
