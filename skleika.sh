#!/bin/bash

# --- Configuration ---
SOURCE_ARG="${1:-.}"
# Resolve to absolute path for consistency
SOURCE_DIR=$(cd "$SOURCE_ARG" && pwd)

if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Source directory '$SOURCE_ARG' not found." >&2
    exit 1
fi

FINAL_OUTPUT="$SOURCE_DIR/project_code.txt"
OUTPUT_FILENAME=$(basename "$FINAL_OUTPUT") # Получаем имя файла для исключения

# Exclusions are now primarily handled by git ls-files or ripgrep.
# These lists are for the additional filtering via grep/rg globs.
DEFAULT_EXCLUDED_FILES=(
    "$OUTPUT_FILENAME"
    "package-lock.json" "yarn.lock" ".env" ".env.*" "*.local" "*.bak" "*.tmp"
    "poetry.lock" "Pipfile.lock" "composer.lock" "*skleika*.sh" "README.md"
    ".DS_Store" "Thumbs.db" ".gitignore"
)

DEFAULT_EXCLUDED_EXTENSIONS=(
    "png" "jpg" "jpeg" "gif" "bmp" "ico" "svg" "webp" "pdf" "doc" "docx"
    "xls" "xlsx" "zip" "tar" "gz" "rar" "7z" "mp3" "mp4" "avi" "mov" "mkv"
    "db" "sqlite" "sqlite3" "pyc" "pyo" "pyd" "log" "lock" "sum" "swp"
)

# --- Git-Optimized Method ---
main_git() {
    echo "INFO: Git repository detected. Using fast, git-based method (awk)." >&2
    cd "$SOURCE_DIR" || exit 1

    # Convert file globs to a regex for grep
    local patterns=()
    for pattern in "${DEFAULT_EXCLUDED_FILES[@]}"; do
        patterns+=("$(echo "$pattern" | sed -e 's/\./\\./g' -e 's/\*/.*/g')")
    done
    local files_regex="($(IFS='|'; echo "${patterns[*]}"))"
    local exts_regex="\\.($(IFS='|'; echo "${DEFAULT_EXCLUDED_EXTENSIONS[*]}"))$"
    local final_exclude_regex="$files_regex$|$exts_regex"
    git ls-files -co --exclude-standard -z . | \
    grep -z -vE "$final_exclude_regex" | \
    xargs -0 awk 'FNR==1{print "\n\n=== " FILENAME " ==="}1'
}

# --- Fallback ripgrep-based Method ---
main_fallback() {
    echo "INFO: Not a Git repository. Using fast, ripgrep-based method (awk)." >&2
    cd "$SOURCE_DIR" || exit 1

    if ! command -v rg &> /dev/null; then
        echo "Error: ripgrep (rg) is not installed. It is the required fallback." >&2
        echo "Please install it (e.g., 'sudo apt-get install ripgrep')." >&2
        exit 1
    fi

    local exclude_globs=()
    for pattern in "${DEFAULT_EXCLUDED_FILES[@]}"; do
        exclude_globs+=(--glob "!$pattern")
    done
    for ext in "${DEFAULT_EXCLUDED_EXTENSIONS[@]}"; do
        exclude_globs+=(--glob "!*.$ext")
    done

    rg --files --hidden -0 "${exclude_globs[@]}" . | \
    xargs -0 awk 'FNR==1{print "\n\n=== " FILENAME " ==="}1'
}


# --- Main Processing ---
echo "INFO: Starting code export from $SOURCE_DIR"
echo "INFO: Final output will be $FINAL_OUTPUT"

rm -f "$FINAL_OUTPUT"

{
    if [ -d "$SOURCE_DIR/.git" ]; then
        main_git
    else
        main_fallback
    fi
} > "$FINAL_OUTPUT"

echo "INFO: Project code successfully exported to $FINAL_OUTPUT"
exit 0