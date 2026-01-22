#!/bin/bash

echo "🔍 Verifying local development setup..."
echo ""

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js: $NODE_VERSION"
else
    echo "❌ Node.js not found"
    exit 1
fi

# Check Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    echo "✅ Docker: $DOCKER_VERSION"
else
    echo "❌ Docker not found"
    exit 1
fi

# Detect Docker Compose command (v1: docker-compose, v2: docker compose)
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD=(docker-compose)
elif docker compose version &> /dev/null; then
    COMPOSE_CMD=(docker compose)
else
    echo "❌ Docker Compose not found (docker-compose or docker compose)"
    exit 1
fi

# Check .env file
if [ -f ".env" ]; then
    echo "✅ .env file exists"
else
    echo "❌ .env file not found"
    exit 1
fi

# Check Docker containers
echo ""
echo "🐳 Checking Docker containers..."
"${COMPOSE_CMD[@]}" ps

# Check core health
echo ""
echo "🏥 Checking core health..."
if command -v jq &> /dev/null; then
  curl -s http://localhost:3000/health | jq '.' || echo "❌ Core not responding"
else
  curl -s http://localhost:3000/health || echo "❌ Core not responding"
fi

# Check router health
echo ""
echo "🏥 Checking router health..."
if command -v jq &> /dev/null; then
  curl -s http://localhost:3001/health | jq '.' || echo "❌ Router not responding"
else
  curl -s http://localhost:3001/health || echo "❌ Router not responding"
fi

echo ""
echo "✅ Verification complete!"
