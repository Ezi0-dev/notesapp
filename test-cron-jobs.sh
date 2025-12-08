#!/bin/bash

# Test script for cron jobs using curl
# Works on Windows with Git Bash or WSL

BASE_URL="http://localhost:5000/api"

echo "========================================"
echo "  Cron Job Testing Script"
echo "========================================"
echo ""

# Login first (matches seed-users.js defaults)
echo "🔐 Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "Admin123!"
  }')

ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Login failed. Please create a test user or update credentials."
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful"
echo ""

# Get scheduler status
echo "📊 Getting scheduler status..."
curl -s -X GET "$BASE_URL/admin/scheduler/status" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | json_pp
echo ""

# Test Token Cleanup
echo "🔧 Testing Token Cleanup..."
curl -s -X POST "$BASE_URL/admin/scheduler/run/Token%20Cleanup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | json_pp
echo ""

# Test Rate Limit Cleanup
echo "🔧 Testing Rate Limit Cleanup..."
curl -s -X POST "$BASE_URL/admin/scheduler/run/Rate%20Limit%20Cleanup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | json_pp
echo ""

# Test Bloat Check
echo "🔧 Testing Bloat Check..."
curl -s -X POST "$BASE_URL/admin/scheduler/run/Bloat%20Check" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | json_pp
echo ""

# Get health metrics
echo "🏥 Getting health metrics..."
curl -s -X GET "$BASE_URL/admin/health/metrics" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | json_pp
echo ""

echo "========================================"
echo "  Testing Complete!"
echo "========================================"
