#!/bin/bash

# --- Configuration ---
# Первый аргумент - это путь, который мы ХОТИМ включить (по умолчанию текущая папка ".")
INCLUDE_TARGET="${1:-.}"
# Разрешаем путь до абсолютного, чтобы не потеряться
INCLUDE_DIR=$(cd "$(dirname "$INCLUDE_TARGET")" && pwd)/$(basename "$INCLUDE_TARGET")
# Получаем корень проекта (там, где запущен скрипт), чтобы сохранить туда результат
PROJECT_ROOT=$(pwd)

if [ ! -e "$INCLUDE_TARGET" ]; then
    echo "Error: Target path '$INCLUDE_TARGET' not found." >&2
    exit 1
fi

FINAL_OUTPUT="$PROJECT_ROOT/project_code.txt"
OUTPUT_FILENAME=$(basename "$FINAL_OUTPUT")

DEFAULT_EXCLUDED_FILES=(
    "$OUTPUT_FILENAME"
    "package-lock.json" "yarn.lock" ".env" ".env.*" "*.local" "*.bak" "*.tmp"
    "poetry.lock" "Pipfile.lock" "composer.lock" "*skleika*.sh" "README.md"
    ".DS_Store" "Thumbs.db" ".gitignore"
)

DEFAULT_EXCLUDED_EXTENSIONS=(
    "png" "jpg" "jpeg" "gif" "bmp" "ico" "icns" "svg" "webp" "pdf" "doc" "docx"
    "xls" "xlsx" "zip" "tar" "gz" "rar" "7z" "mp3" "mp4" "avi" "mov" "mkv"
    "db" "sqlite" "sqlite3" "pyc" "pyo" "pyd" "log" "lock" "sum" "swp" "jar"
)

# --- Git-Optimized Method ---
main_git() {
    echo "INFO: Git repository detected. Using fast, git-based method (awk)." >&2
    cd "$PROJECT_ROOT" || exit 1

    local patterns=()
    for pattern in "${DEFAULT_EXCLUDED_FILES[@]}"; do
        patterns+=("$(echo "$pattern" | sed -e 's/\./\\./g' -e 's/\*/.*/g')")
    done
    local files_regex="($(IFS='|'; echo "${patterns[*]}"))"
    local exts_regex="\\.($(IFS='|'; echo "${DEFAULT_EXCLUDED_EXTENSIONS[*]}"))$"
    local final_exclude_regex="$files_regex$|$exts_regex"
    
    # Передаем $INCLUDE_TARGET в git ls-files, чтобы искать только там
    git ls-files -co --exclude-standard -z "$INCLUDE_TARGET" | \
    grep -z -vE "$final_exclude_regex" | \
    xargs -0 awk 'FNR==1{print "\n\n=== " FILENAME " ==="}1'
}

# --- Fallback ripgrep-based Method ---
main_fallback() {
    echo "INFO: Not a Git repository. Using fast, ripgrep-based method (awk)." >&2
    cd "$PROJECT_ROOT" || exit 1

    if ! command -v rg &> /dev/null; then
        echo "Error: ripgrep (rg) is not installed. It is the required fallback." >&2
        exit 1
    fi

    local exclude_globs=()
    for pattern in "${DEFAULT_EXCLUDED_FILES[@]}"; do
        exclude_globs+=(--glob "!$pattern")
    done
    for ext in "${DEFAULT_EXCLUDED_EXTENSIONS[@]}"; do
        exclude_globs+=(--glob "!*.$ext")
    done

    # Передаем $INCLUDE_TARGET в rg, чтобы искать только там
    rg --files --hidden -0 "${exclude_globs[@]}" "$INCLUDE_TARGET" | \
    xargs -0 awk 'FNR==1{print "\n\n=== " FILENAME " ==="}1'
}

# --- Main Processing ---
echo "INFO: Target path to include: $INCLUDE_TARGET"
echo "INFO: Final output will be $FINAL_OUTPUT"

rm -f "$FINAL_OUTPUT"

{
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        main_git
    else
        main_fallback
    fi
} > "$FINAL_OUTPUT"

echo "INFO: Project code successfully exported to $FINAL_OUTPUT"
exit 0
