#!/bin/bash

echo "🚀 GreenReach Central API Setup"
echo "================================"
echo ""

# Check Node.js version
echo "📌 Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Error: Node.js 18 or higher is required. You have: $(node -v)"
  exit 1
fi
echo "✅ Node.js version: $(node -v)"
echo ""

# Check PostgreSQL
echo "📌 Checking PostgreSQL..."
if ! command -v psql &> /dev/null; then
  echo "❌ Error: PostgreSQL is not installed"
  echo "   Install with: brew install postgresql@14 (macOS)"
  exit 1
fi
echo "✅ PostgreSQL found: $(psql --version)"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "⚠️  No .env file found. Creating from .env.example..."
  cp .env.example .env
  
  # Generate JWT secret
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  
  # Update .env with generated JWT secret
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/your_jwt_secret_here_replace_with_secure_random_string/$JWT_SECRET/" .env
  else
    sed -i "s/your_jwt_secret_here_replace_with_secure_random_string/$JWT_SECRET/" .env
  fi
  
  echo "✅ Created .env file with generated JWT secret"
  echo "   ⚠️  You still need to configure database credentials in .env"
  echo ""
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
  echo "❌ Failed to install dependencies"
  exit 1
fi
echo "✅ Dependencies installed"
echo ""

# Create logs directory
echo "📁 Creating logs directory..."
mkdir -p logs
echo "✅ Logs directory created"
echo ""

# Database setup
echo "🗄️  Database Setup"
echo "=================="
read -p "Do you want to create the database now? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Load .env
  export $(cat .env | grep -v '^#' | xargs)
  
  echo "📌 Creating database: $DB_NAME"
  createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME 2>/dev/null
  
  if [ $? -eq 0 ]; then
    echo "✅ Database created"
  else
    echo "⚠️  Database may already exist or error occurred"
  fi
  
  echo "📌 Running schema.sql..."
  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f schema.sql
  
  if [ $? -eq 0 ]; then
    echo "✅ Schema applied successfully"
  else
    echo "❌ Failed to apply schema"
    exit 1
  fi
fi

echo ""
echo "✨ Setup Complete!"
echo "=================="
echo ""
echo "📝 Next Steps:"
echo "  1. Edit .env and configure your database credentials"
echo "  2. Start the server: npm run dev"
echo "  3. Test the API: curl http://localhost:3000/health"
echo "  4. View logs: tail -f logs/combined.log"
echo ""
echo "📚 Documentation: See README.md for API endpoints and usage"
echo ""
