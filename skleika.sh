#!/bin/bash

resolve_self_path() {
    local source="${BASH_SOURCE[0]}"
    local dir

    while [ -L "$source" ]; do
        dir=$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)
        source=$(readlink "$source")
        [[ "$source" != /* ]] && source="$dir/$source"
    done

    dir=$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)
    printf '%s/%s\n' "$dir" "$(basename "$source")"
}

is_safe_install_path() {
    local path="$1"

    [ "$(basename "$path")" = "skleika" ] || return 1

    case "$path" in
        "/usr/local/bin/skleika"|"$HOME/.local/bin/skleika"|"$HOME/bin/skleika")
            return 0
            ;;
    esac

    return 1
}

remove_installed_file() {
    local path="$1"
    local dir

    [ -e "$path" ] || return 0
    dir=$(dirname "$path")

    if [ -w "$dir" ]; then
        rm -f "$path"
    elif command -v sudo >/dev/null 2>&1; then
        sudo rm -f "$path"
    else
        echo "Error: Cannot remove '$path'. Try again with sufficient permissions." >&2
        return 1
    fi
}

uninstall_skleika() {
    local assume_yes="${1:-no}"
    local self_path
    local wrapper_path
    local answer

    self_path=$(resolve_self_path)
    wrapper_path="$(dirname "$self_path")/skleika.ps1"

    if ! is_safe_install_path "$self_path"; then
        echo "Error: Refusing to uninstall from '$self_path'." >&2
        echo "Error: This does not look like an installed global skleika command." >&2
        exit 1
    fi

    if [ "$assume_yes" != "yes" ]; then
        read -r -p "Remove skleika? [y/N] " answer
        case "$answer" in
            [yY]|[yY][eE][sS])
                ;;
            *)
                echo "INFO: Uninstall cancelled."
                exit 0
                ;;
        esac
    fi

    if [ -f "$wrapper_path" ] && grep -q "SKLEIKA_POWERSHELL_WRAPPER" "$wrapper_path"; then
        remove_installed_file "$wrapper_path" || exit 1
        echo "INFO: Removed $wrapper_path"
    fi

    remove_installed_file "$self_path" || exit 1
    echo "INFO: Removed $self_path"
    echo "INFO: skleika uninstalled."
    exit 0
}

if [ "${1:-}" = "uninstall" ]; then
    if [ "$#" -eq 1 ]; then
        uninstall_skleika "no"
    elif [ "$#" -eq 2 ] && [ "${2:-}" = "--yes" ]; then
        uninstall_skleika "yes"
    else
        echo "Usage: skleika uninstall [--yes]" >&2
        exit 1
    fi
fi

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
        cat >&2 <<'EOF'
Error: ripgrep (rg) is not installed. It is required when skleika runs outside a Git repository.

Install ripgrep:
  Debian/Ubuntu: sudo apt install ripgrep
  macOS: brew install ripgrep
  Windows winget: winget install BurntSushi.ripgrep.MSVC
  Windows Chocolatey: choco install ripgrep
  Windows Scoop: scoop install ripgrep
EOF
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
