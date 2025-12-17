#!/bin/bash

# Remove all emojis from codebase
# This script removes common emojis while preserving functionality

echo "Removing emojis from codebase..."

# Define emoji replacements (emoji -> text alternative)
declare -A replacements=(
    ["🔍"]="[SEARCH]"
    ["✅"]="[OK]"
    ["❌"]="[ERROR]"
    ["⚠️"]="[WARNING]"
    ["⚡"]="[FAST]"
    ["🔥"]="[HOT]"
    ["📊"]="[STATS]"
    ["📈"]="[UP]"
    ["📉"]="[DOWN]"
    ["🌱"]=""
    ["🌿"]=""
    ["💧"]="[WATER]"
    ["💡"]="[IDEA]"
    ["🔔"]="[ALERT]"
    ["⭐"]="[STAR]"
    ["👤"]="[USER]"
    ["👥"]="[USERS]"
    ["📦"]=""
    ["🚀"]="[START]"
    ["🎯"]="[TARGET]"
    ["💰"]="[MONEY]"
    ["📝"]="[NOTE]"
    ["🛠️"]="[TOOLS]"
    ["⚙️"]=""
    ["📅"]="[DATE]"
    ["🕐"]="[TIME]"
    ["❤️"]=""
    ["💚"]=""
    ["💙"]=""
    ["🟢"]="[GREEN]"
    ["🔴"]="[RED]"
    ["🟡"]="[YELLOW]"
    ["🟠"]="[ORANGE]"
    ["⬆️"]="[UP]"
    ["⬇️"]="[DOWN]"
    ["➡️"]="[NEXT]"
    ["⬅️"]="[BACK]"
    ["🔄"]="[REFRESH]"
    ["🔁"]="[REPEAT]"
    ["🆕"]="[NEW]"
    ["🆓"]="[FREE]"
    ["🏆"]="[WIN]"
    ["🎉"]="[SUCCESS]"
    ["🎊"]="[CELEBRATE]"
    ["👍"]="[GOOD]"
    ["👎"]="[BAD]"
    ["✨"]="[SPARKLE]"
    ["🌟"]="[STAR]"
    ["📌"]="[PIN]"
    ["📍"]="[LOCATION]"
    ["🔖"]="[BOOKMARK]"
    ["📂"]="[FOLDER]"
    ["📁"]="[DIR]"
    ["🗂️"]="[FILES]"
    ["📋"]=""
    ["📄"]="[DOC]"
    ["📃"]="[PAGE]"
    ["🗃️"]="[ARCHIVE]"
    ["✓"]="[OK]"
    ["✗"]="[FAIL]"
)

# Find all relevant files (excluding node_modules, venv, .git, mobile-app, docs)
files=$(find . -type f \( -name "*.js" -o -name "*.html" -o -name "*.css" \) \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" \
    -not -path "*/venv/*" \
    -not -path "*/mobile-app/*" \
    -not -path "*/docs/*" \
    -not -path "*/backups/*")

count=0
for file in $files; do
    modified=false
    
    # Check if file contains any emojis
    if grep -q "[\u2705\u274C\u26A0\u{1F300}-\u{1F9FF}]" "$file" 2>/dev/null || \
       grep -E "✅|❌|⚠️|🔍|💡|📊|🚀|🌱|📦|🔄|🎯|⚙️|📋|✓|✗|🔥|📈|📉|🌿|💧|🔔|⭐|👤|👥|📝|🛠️|📅|🕐|⚡" "$file" >/dev/null 2>&1; then
        
        # Create backup
        cp "$file" "$file.emoji-backup"
        
        # Remove/replace emojis
        for emoji in "${!replacements[@]}"; do
            replacement="${replacements[$emoji]}"
            # Use LC_ALL=C to handle special characters
            LC_ALL=C sed -i '' "s/$emoji/$replacement/g" "$file" 2>/dev/null || true
        done
        
        modified=true
        ((count++))
        echo "Processed: $file"
    fi
done

echo ""
echo "Emoji removal complete!"
echo "Files modified: $count"
echo "Backups saved with .emoji-backup extension"
echo ""
echo "To restore backups if needed:"
echo "  find . -name '*.emoji-backup' -exec sh -c 'mv \"\$1\" \"\${1%.emoji-backup}\"' _ {} \\;"
