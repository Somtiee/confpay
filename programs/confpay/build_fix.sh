#!/bin/bash
export PATH=/usr/bin:/bin:/usr/local/bin:/home/somto/.cargo/bin
# Try to find the real binary
REAL_CARGO_BUILD_SBF=$(find /usr/local/bin -maxdepth 1 -not -type l -name "cargo-build-sbf")
if [ -z "$REAL_CARGO_BUILD_SBF" ]; then
    echo "Real binary not found in /usr/local/bin, trying /usr/bin"
    REAL_CARGO_BUILD_SBF=$(find /usr/bin -maxdepth 1 -not -type l -name "cargo-build-sbf")
fi

if [ -n "$REAL_CARGO_BUILD_SBF" ]; then
    echo "Found real binary: $REAL_CARGO_BUILD_SBF"
    $REAL_CARGO_BUILD_SBF "$@"
else
    echo "Real binary not found, trying cargo build-sbf with clean PATH"
    # Removing .local/bin from PATH
    export PATH=$(echo $PATH | sed -e 's|/home/somto/.local/bin:||g')
    cargo build-sbf "$@"
fi
