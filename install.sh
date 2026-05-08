#!/usr/bin/env bash
set -euo pipefail

REPO_RAW_BASE_URL="${SKLEIKA_REPO_RAW_BASE_URL:-https://raw.githubusercontent.com/apertso/hub/main}"
SOURCE_DIR=""

case "${BASH_SOURCE[0]:-}" in
    */install.sh|install.sh)
        SOURCE_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
        ;;
esac

is_windows_git_bash() {
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            return 0
            ;;
    esac

    return 1
}

download_file() {
    local url="$1"
    local dest="$2"

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$dest"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$dest" "$url"
    else
        echo "Error: curl or wget is required to download skleika." >&2
        exit 1
    fi
}

copy_or_download() {
    local name="$1"
    local dest="$2"

    if [ -n "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/$name" ]; then
        cp "$SOURCE_DIR/$name" "$dest"
    else
        download_file "$REPO_RAW_BASE_URL/$name" "$dest"
    fi
}

install_direct() {
    local src="$1"
    local dest="$2"
    local mode="$3"
    local dir

    dir=$(dirname "$dest")

    if [ ! -d "$dir" ]; then
        mkdir -p "$dir" 2>/dev/null || return 1
    fi

    [ -w "$dir" ] || return 1
    cp "$src" "$dest" || return 1
    chmod "$mode" "$dest" || return 1
}

install_with_sudo() {
    local src="$1"
    local dest="$2"
    local mode="$3"
    local dir

    command -v sudo >/dev/null 2>&1 || return 1
    dir=$(dirname "$dest")

    sudo mkdir -p "$dir" && sudo cp "$src" "$dest" && sudo chmod "$mode" "$dest"
}

install_file() {
    local src="$1"
    local dest="$2"
    local mode="$3"
    local allow_sudo="${4:-no}"

    install_direct "$src" "$dest" "$mode" && return 0

    if [ "$allow_sudo" = "yes" ]; then
        install_with_sudo "$src" "$dest" "$mode" && return 0
    fi

    return 1
}

path_contains_dir() {
    local dir="$1"

    case ":$PATH:" in
        *":$dir:"*)
            return 0
            ;;
    esac

    return 1
}

to_windows_path() {
    local path="$1"

    if command -v cygpath >/dev/null 2>&1; then
        cygpath -w "$path"
    else
        printf '%s\n' "$path"
    fi
}

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

script_src="$tmp_dir/skleika"
copy_or_download "skleika.sh" "$script_src"
chmod +x "$script_src"

if is_windows_git_bash; then
    install_dir="$HOME/bin"
    install_path="$install_dir/skleika"

    install_file "$script_src" "$install_path" "755" "no" || {
        echo "Error: Failed to install skleika to $install_path" >&2
        exit 1
    }

    wrapper_src="$tmp_dir/skleika.ps1"
    wrapper_path="$install_dir/skleika.ps1"
    copy_or_download "skleika.ps1" "$wrapper_src"

    install_file "$wrapper_src" "$wrapper_path" "644" "no" || {
        echo "Error: Failed to install PowerShell wrapper to $wrapper_path" >&2
        exit 1
    }

    echo "INFO: Installed skleika to $install_path"
    echo "INFO: Installed PowerShell wrapper to $wrapper_path"
    echo "INFO: Git Bash is required to run skleika on Windows."
    echo "INFO: For PowerShell, ensure $(to_windows_path "$install_dir") is in your User PATH."
else
    install_path="/usr/local/bin/skleika"

    if install_file "$script_src" "$install_path" "755" "yes"; then
        install_dir="/usr/local/bin"
    else
        install_dir="$HOME/.local/bin"
        install_path="$install_dir/skleika"
        echo "INFO: Falling back to $install_path"

        install_file "$script_src" "$install_path" "755" "no" || {
            echo "Error: Failed to install skleika to $install_path" >&2
            exit 1
        }
    fi

    echo "INFO: Installed skleika to $install_path"
fi

if ! path_contains_dir "$install_dir"; then
    echo "WARN: $install_dir is not in PATH."
    echo "WARN: Add it to PATH before running 'skleika' from any directory."
fi

echo "INFO: Run 'skleika' to export project_code.txt."
