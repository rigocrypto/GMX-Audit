#!/bin/bash
# Moonwell Test Command Reference
# Add these to your package.json "scripts" section

# Quick test (minimal runs, debugging)
npm run test:moonwell:quick

# Full fuzz suite (500 runs)
npm run test:moonwell:fuzz

# Extended (fuzz + liquidation simulation)
npm run test:moonwell:extended

# Run with specific seed (reproducible)
npm run test:moonwell -- --seed 12345

# Test specific chain
MOONWELL_CHAIN=base npm run test:moonwell
MOONWELL_CHAIN=optimism npm run test:moonwell
MOONWELL_CHAIN=arbitrum npm run test:moonwell

# Profile/debug
npm run test:moonwell -- --reporter spec --bail

# Triage Moonwell proofs
npm run triage:moonwell

# Generate Immunefi report from proof
npm run generate-immunefi -- --proof exploit-proofs/moonwell/proof.json

# Full bounty rotation (GMX + Moonwell)
npm run bounty-rotation:full
