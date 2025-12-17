#!/bin/bash
# PostgreSQL Local Setup Script for macOS
# Installs PostgreSQL via Homebrew and sets up Light Engine database

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌱 Light Engine - PostgreSQL Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if PostgreSQL is installed
if command -v psql &> /dev/null; then
    echo -e "${GREEN}✅ PostgreSQL already installed${NC}"
    psql --version
else
    echo -e "${YELLOW}📦 Installing PostgreSQL via Homebrew...${NC}"
    brew install postgresql@16
    echo -e "${GREEN}✅ PostgreSQL installed${NC}"
fi

# Start PostgreSQL service
echo ""
echo -e "${YELLOW}🚀 Starting PostgreSQL service...${NC}"
brew services start postgresql@16 2>/dev/null || brew services restart postgresql@16
sleep 3

# Check if service is running
if brew services list | grep postgresql@16 | grep started > /dev/null; then
    echo -e "${GREEN}✅ PostgreSQL service started${NC}"
else
    echo -e "${RED}❌ Failed to start PostgreSQL service${NC}"
    exit 1
fi

# Database configuration
DB_NAME="lightengine"
DB_USER="lightengine"
DB_PASSWORD="lightengine_dev_password"

# Check if database exists
if psql -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
    echo ""
    echo -e "${YELLOW}⚠️  Database '$DB_NAME' already exists${NC}"
    read -p "Do you want to drop and recreate it? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}🗑️  Dropping database '$DB_NAME'...${NC}"
        dropdb $DB_NAME 2>/dev/null || true
    else
        echo -e "${GREEN}✅ Using existing database${NC}"
        DB_EXISTS=true
    fi
fi

# Create database if it doesn't exist
if [ -z "$DB_EXISTS" ]; then
    echo ""
    echo -e "${YELLOW}📂 Creating database '$DB_NAME'...${NC}"
    createdb $DB_NAME
    echo -e "${GREEN}✅ Database created${NC}"
fi

# Create user if doesn't exist
echo ""
echo -e "${YELLOW}👤 Setting up database user...${NC}"
psql -d postgres -tc "SELECT 1 FROM pg_user WHERE usename = '$DB_USER'" | grep -q 1 || \
    psql -d postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"

# Grant privileges
psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" > /dev/null
echo -e "${GREEN}✅ User '$DB_USER' configured${NC}"

# Run initialization script if exists
if [ -f "./scripts/init-db.sql" ]; then
    echo ""
    echo -e "${YELLOW}🔧 Running initialization script...${NC}"
    psql -U $DB_USER -d $DB_NAME -f ./scripts/init-db.sql
    echo -e "${GREEN}✅ Database initialized${NC}"
fi

# Update .env file
echo ""
echo -e "${YELLOW}📝 Updating .env file...${NC}"
ENV_FILE=".env"
DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"

if [ -f "$ENV_FILE" ]; then
    # Backup .env
    cp $ENV_FILE ${ENV_FILE}.backup
    
    # Update or add DATABASE_URL
    if grep -q "^DATABASE_URL=" $ENV_FILE; then
        # Comment out old SQLite URL
        sed -i.bak '/^DATABASE_URL=sqlite:/s/^/# /' $ENV_FILE
        # Add PostgreSQL URL
        echo "DATABASE_URL=$DATABASE_URL" >> $ENV_FILE
    else
        echo "DATABASE_URL=$DATABASE_URL" >> $ENV_FILE
    fi
    
    echo -e "${GREEN}✅ .env updated (backup saved to .env.backup)${NC}"
else
    echo "DATABASE_URL=$DATABASE_URL" > $ENV_FILE
    echo -e "${GREEN}✅ .env file created${NC}"
fi

# Run Alembic migrations
echo ""
echo -e "${YELLOW}🔄 Running database migrations...${NC}"
export DATABASE_URL=$DATABASE_URL
if alembic upgrade head 2>/dev/null; then
    echo -e "${GREEN}✅ Migrations completed${NC}"
else
    echo -e "${YELLOW}⚠️  Alembic not found or migrations failed. Run manually:${NC}"
    echo -e "   ${YELLOW}alembic upgrade head${NC}"
fi

# Test connection
echo ""
echo -e "${YELLOW}🧪 Testing database connection...${NC}"
python3 << EOF
try:
    from backend.models.base import get_db_session
    from backend.models.user import User
    
    with get_db_session() as session:
        count = session.query(User).count()
        print(f"${GREEN}✅ Connection successful! User count: {count}${NC}")
except Exception as e:
    print(f"${RED}❌ Connection failed: {e}${NC}")
    exit(1)
EOF

# Display summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ PostgreSQL Setup Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Database Information:"
echo "   Database: $DB_NAME"
echo "   User: $DB_USER"
echo "   Host: localhost"
echo "   Port: 5432"
echo ""
echo "🔗 Connection String:"
echo "   $DATABASE_URL"
echo ""
echo "📝 Next Steps:"
echo "   1. Start backend: python3 -m backend"
echo "   2. Test auth: curl http://localhost:8000/auth/register"
echo "   3. View data: psql -U $DB_USER -d $DB_NAME"
echo ""
echo "📚 Documentation: POSTGRESQL_SETUP_GUIDE.md"
echo ""
